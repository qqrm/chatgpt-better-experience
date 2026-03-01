import { FeatureContext, FeatureHandle } from "../application/featureContext";

const TASK_PATH_PREFIX = "/codex/tasks/";
const GIT_ACTION_TRIGGER_SELECTOR = 'button[aria-label="Open git action menu"]';
const MENU_ITEM_SELECTOR = '[role="menuitem"]';
const CLIPBOARD_HOOK_SOURCE = "qqrm-clipboard-hook";
const CLIPBOARD_HOOK_READY_ATTR = "data-qqrm-clipboard-hook-installed";
const CLIPBOARD_HOOK_READY_TIMEOUT_MS = 1500;
const CAPTURE_TIMEOUT_MS = 5000;
const CLIPBOARD_READ_RETRY_DELAY_MS = 120;
const CLIPBOARD_READ_ATTEMPTS = 4;
const CAPTURE_WAIT_BEFORE_CLIPBOARD_MS = 350;
const MESSAGE_TIMEOUT_MS = 30000;
const PATCH_DOWNLOAD_SAVE_AS = false;

type DownloadPatchResponse = { ok: true; downloadId: number } | { ok: false; error: string };
type DownloadPatchRequestMessage = {
  type: "downloadPatch";
  filename: string;
  text: string;
  saveAs?: boolean;
};

type ChromeRuntime = {
  sendMessage?: (message: unknown, callback: (response?: DownloadPatchResponse) => void) => void;
  lastError?: { message?: string };
};

type BrowserRuntime = {
  sendMessage?: (message: unknown) => Promise<DownloadPatchResponse>;
};

type PendingCapture = {
  resolve: (value: { text: string | null; transport?: string }) => void;
  timeoutId: number;
};

export function initDownloadPatchMenuItemFeature(ctx: FeatureContext): FeatureHandle {
  let disposed = false;
  let hookInjected = false;
  let hookReady = document.documentElement?.getAttribute(CLIPBOARD_HOOK_READY_ATTR) === "1";
  let warmupPromise: Promise<boolean> | null = null;
  let activeOperationId: string | null = null;

  const pendingCaptures = new Map<string, PendingCapture>();

  const injectPageClipboardHookOnce = () => {
    if (hookInjected) return;
    hookInjected = true;

    const runtime =
      (
        globalThis as typeof globalThis & {
          chrome?: { runtime?: { getURL?: (path: string) => string } };
        }
      ).chrome?.runtime ??
      (
        globalThis as typeof globalThis & {
          browser?: { runtime?: { getURL?: (path: string) => string } };
        }
      ).browser?.runtime;

    if (!runtime?.getURL) return;
    if (document.querySelector('script[data-qqrm-clipboard-hook="1"]')) return;

    const script = document.createElement("script");
    script.setAttribute("data-qqrm-clipboard-hook", "1");
    script.dataset.source = CLIPBOARD_HOOK_SOURCE;
    script.src = runtime.getURL("pageClipboardHook.js");
    script.onload = () => script.remove();
    document.documentElement.appendChild(script);
  };

  const waitForHookReady = (timeoutMs: number): Promise<boolean> => {
    if (hookReady || document.documentElement?.getAttribute(CLIPBOARD_HOOK_READY_ATTR) === "1") {
      hookReady = true;
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const onMessage = (event: MessageEvent) => {
        if (event.source !== window) return;
        const data = event.data as { source?: string; type?: string };
        if (!data || data.source !== CLIPBOARD_HOOK_SOURCE || data.type !== "ready") return;

        hookReady = true;
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        window.removeEventListener("message", onMessage);
        resolve(true);
      };

      const timeoutId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        window.removeEventListener("message", onMessage);
        resolve(false);
      }, timeoutMs);

      window.addEventListener("message", onMessage);
    });
  };

  const prewarmClipboardHook = () => {
    injectPageClipboardHookOnce();
    if (hookReady || warmupPromise) return;
    warmupPromise = waitForHookReady(CLIPBOARD_HOOK_READY_TIMEOUT_MS)
      .catch(() => false)
      .finally(() => {
        warmupPromise = null;
      });
  };

  const beginCapturePassthrough = () => {
    const id = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

    const resultPromise = new Promise<{ text: string | null; transport?: string }>((resolve) => {
      const timeoutId = window.setTimeout(() => {
        pendingCaptures.delete(id);
        resolve({ text: null });
      }, CAPTURE_TIMEOUT_MS);

      pendingCaptures.set(id, { resolve, timeoutId });
    });

    if (hookReady || document.documentElement?.getAttribute(CLIPBOARD_HOOK_READY_ATTR) === "1") {
      hookReady = true;
      window.postMessage(
        { source: CLIPBOARD_HOOK_SOURCE, type: "begin", id, mode: "passthrough" },
        "*"
      );
    }

    return { id, resultPromise };
  };

  const handleClipboardMessage = (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as {
      source?: string;
      type?: string;
      id?: string;
      text?: string;
      transport?: string;
    };

    if (!data || data.source !== CLIPBOARD_HOOK_SOURCE) return;
    if (data.type === "ready") {
      hookReady = true;
      return;
    }

    if (data.type !== "captured" || !data.id) return;
    const pending = pendingCaptures.get(data.id);
    if (!pending) return;

    window.clearTimeout(pending.timeoutId);
    pendingCaptures.delete(data.id);
    pending.resolve({ text: data.text ?? null, transport: data.transport });
  };

  const handleClickCapture = (event: MouseEvent) => {
    if (!window.location.pathname.startsWith(TASK_PATH_PREFIX)) return;
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest(GIT_ACTION_TRIGGER_SELECTOR)) {
      prewarmClipboardHook();
      return;
    }

    if (!ctx.settings.downloadGitPatchesWithShiftClick) return;
    if (!event.shiftKey) return;

    const menuItem = target.closest<HTMLElement>(MENU_ITEM_SELECTOR);
    if (!menuItem || !isCopyPatchActionItem(menuItem)) return;
    if (activeOperationId) return;

    const traceId = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    activeOperationId = traceId;

    const capture = beginCapturePassthrough();

    window.setTimeout(() => {
      if (disposed) return;
      void processShiftDownload(capture.resultPromise, traceId);
    }, 0);
  };

  const processShiftDownload = async (
    capturePromise: Promise<{ text: string | null; transport?: string }>,
    traceId: string
  ) => {
    try {
      const captured = await withTimeout(capturePromise, CAPTURE_WAIT_BEFORE_CLIPBOARD_MS, {
        text: null,
        transport: undefined
      });
      const clipboardPatch = await readPatchFromClipboard();
      const normalizedCaptured = normalizePatchText(captured.text ?? "");
      let patch = clipboardPatch;

      if (!patch) {
        patch = looksLikePatch(normalizedCaptured) ? normalizedCaptured : null;
      }

      if (!patch) {
        patch = tryExtractFullPatchFromDom();
      }

      if (!patch) {
        window.alert(
          "Download failed: Unable to capture patch content (clipboard and DOM fallback failed)."
        );
        return;
      }

      const baseFilename = buildPatchFilenameBase();
      const patchDownloads = await Promise.all([
        requestPatchDownload({ filename: `${baseFilename}.patch`, text: patch }),
        requestPatchDownload({ filename: `${baseFilename}.gitapply`, text: patch })
      ]);

      const failed = patchDownloads.find((result) => !result.ok);
      if (failed && !failed.ok) {
        window.alert(`Download failed: ${failed.error}`);
        return;
      }

      if (ctx.settings.clearClipboardAfterShiftDownload) {
        try {
          await navigator.clipboard.writeText("");
        } catch {
          // best effort only
        }
      }
    } finally {
      activeOperationId = null;
      void traceId;
    }
  };

  window.addEventListener("message", handleClipboardMessage);
  document.addEventListener("click", handleClickCapture, true);

  if (window.location.pathname.startsWith(TASK_PATH_PREFIX)) {
    prewarmClipboardHook();
  }

  return {
    name: "downloadPatchMenuItem",
    onSettingsChange: (nextSettings) => {
      if (
        nextSettings.downloadGitPatchesWithShiftClick &&
        window.location.pathname.startsWith(TASK_PATH_PREFIX)
      ) {
        prewarmClipboardHook();
      }
    },
    dispose: () => {
      disposed = true;
      document.removeEventListener("click", handleClickCapture, true);
      window.removeEventListener("message", handleClipboardMessage);
      for (const [id, pending] of pendingCaptures.entries()) {
        window.clearTimeout(pending.timeoutId);
        pending.resolve({ text: null });
        pendingCaptures.delete(id);
      }
    },
    getStatus: () => ({ active: true })
  };
}

function isCopyPatchActionItem(item: HTMLElement): boolean {
  const text = normalizeActionLabel(item.textContent ?? "");
  const ariaLabel = normalizeActionLabel(item.getAttribute("aria-label") ?? "");
  return (
    text === "copy patch" ||
    text === "copy git apply" ||
    ariaLabel === "copy patch" ||
    ariaLabel === "copy git apply"
  );
}

function normalizeActionLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function looksLikePatch(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length <= 20) return false;

  const lower = normalized.toLowerCase();
  if (lower === "copied patch to clipboard" || lower === "patch copied to clipboard") {
    return false;
  }

  if (normalized.includes("diff --git")) return true;
  return normalized.includes("--- ") && normalized.includes("+++ ") && normalized.includes("@@");
}

function normalizePatchText(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (normalized.length === 0) return "";
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.hidden) return false;
  const style = window.getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden";
}

function tryExtractFullPatchFromDom(): string | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>("pre, code, textarea, [data-testid*='patch']")
  )
    .filter(isVisible)
    .map((el) => normalizePatchText(el.textContent ?? ""))
    .filter((text) => looksLikePatch(text));

  if (candidates.length === 0) return null;

  const withDiff = candidates.filter((text) => text.includes("diff --git"));
  const pool = withDiff.length > 0 ? withDiff : candidates;
  pool.sort((a, b) => b.length - a.length);
  return pool[0] ?? null;
}

async function readPatchFromClipboard(): Promise<string | null> {
  const clipboardApi = navigator.clipboard as Clipboard | undefined;
  const readText = clipboardApi?.readText?.bind(clipboardApi);
  if (!readText) return null;

  for (let i = 0; i < CLIPBOARD_READ_ATTEMPTS; i += 1) {
    if (i > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, CLIPBOARD_READ_RETRY_DELAY_MS));
    }

    try {
      const text = normalizePatchText(await readText());
      if (looksLikePatch(text)) return text;
    } catch {
      return null;
    }
  }

  return null;
}

function buildPatchFilenameBase(): string {
  const title = findTaskTitle();
  const repo = findHeaderValue(/repo/i);
  const branch = findHeaderValue(/branch/i);

  if (!title || !repo || !branch) return "task-patch";

  const slug = [title, repo, branch].map(slugify).filter(Boolean).join("-");
  if (!slug) return "task-patch";
  return slug;
}

function findTaskTitle(): string | null {
  const heading = document.querySelector("h1");
  const text = heading?.textContent?.trim();
  return text || null;
}

function findHeaderValue(labelPattern: RegExp): string | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>("header, main, section, div")
  );

  for (const el of candidates) {
    const text = el.textContent?.trim();
    if (!text || !labelPattern.test(text)) continue;

    const normalized = text.replace(/\s+/g, " ");
    const match = normalized.match(new RegExp(`${labelPattern.source}\\s*[:-]\\s*([^|•]+)`, "i"));
    if (match?.[1]) return match[1].trim();
  }

  return null;
}

function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[^\u0020-\u007e]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutValue: T): Promise<T> {
  let timeoutId: number | null = null;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutId = window.setTimeout(() => {
      timeoutId = null;
      resolve(timeoutValue);
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
}

async function requestPatchDownload({
  filename,
  text
}: {
  filename: string;
  text: string;
}): Promise<DownloadPatchResponse> {
  const message: DownloadPatchRequestMessage = {
    type: "downloadPatch",
    filename,
    text,
    saveAs: PATCH_DOWNLOAD_SAVE_AS
  };

  const browserRuntime =
    (
      globalThis as typeof globalThis & {
        browser?: { runtime?: BrowserRuntime };
      }
    ).browser?.runtime ?? null;

  if (browserRuntime?.sendMessage) {
    try {
      const response = await withTimeout(browserRuntime.sendMessage(message), MESSAGE_TIMEOUT_MS, {
        ok: false,
        error: "Background timeout"
      });
      return response ?? { ok: false, error: "Background did not provide a response." };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to send download message."
      };
    }
  }

  const chromeRuntime =
    (
      globalThis as typeof globalThis & {
        chrome?: { runtime?: ChromeRuntime };
      }
    ).chrome?.runtime ?? null;

  if (!chromeRuntime?.sendMessage) {
    return { ok: false, error: "Runtime messaging API unavailable." };
  }

  return new Promise<DownloadPatchResponse>((resolve) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: "Background timeout" });
    }, MESSAGE_TIMEOUT_MS);

    chromeRuntime.sendMessage?.(message, (response?: DownloadPatchResponse) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);

      const runtimeError = chromeRuntime.lastError;
      if (runtimeError?.message) {
        resolve({ ok: false, error: runtimeError.message });
        return;
      }

      resolve(response ?? { ok: false, error: "Background did not provide a response." });
    });
  });
}
