import { FeatureContext, FeatureHandle } from "../application/featureContext";

const TASK_PATH_PREFIX = "/codex/tasks/";
const MENU_ITEM_SELECTOR = '[role="menuitem"]';
const CLIPBOARD_READ_RETRY_DELAY_MS = 120;
const CLIPBOARD_READ_ATTEMPTS = 4;
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

export function initDownloadPatchMenuItemFeature(ctx: FeatureContext): FeatureHandle {
  let disposed = false;
  let activeOperationId: string | null = null;

  const handleClickCapture = (event: MouseEvent) => {
    if (!window.location.pathname.startsWith(TASK_PATH_PREFIX)) return;
    const target = event.target;
    if (!(target instanceof Element)) return;

    // No page-level clipboard hook: ChatGPT CSP blocks injected scripts.
    // Keep feature working via clipboard (best effort) + DOM extraction.

    if (!ctx.settings.downloadGitPatchesWithShiftClick) return;
    if (!event.shiftKey) return;

    const menuItem = target.closest<HTMLElement>(MENU_ITEM_SELECTOR);
    if (!menuItem || !isCopyPatchActionItem(menuItem)) return;
    if (activeOperationId) return;

    const traceId = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    activeOperationId = traceId;

    window.setTimeout(() => {
      if (disposed) return;
      void processShiftDownload(traceId);
    }, 0);
  };

  const processShiftDownload = async (traceId: string) => {
    try {
      const clipboardPatch = await readPatchFromClipboard();
      let patch = clipboardPatch;

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

      try {
        await navigator.clipboard.writeText("");
      } catch {
        // best effort only
      }
    } finally {
      activeOperationId = null;
      void traceId;
    }
  };

  document.addEventListener("click", handleClickCapture, true);

  return {
    name: "downloadPatchMenuItem",
    onSettingsChange: () => {},
    dispose: () => {
      disposed = true;
      document.removeEventListener("click", handleClickCapture, true);
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
