import { FeatureContext, FeatureHandle } from "../application/featureContext";

const TASK_PATH_PREFIX = "/codex/tasks/";
const GIT_ACTION_TRIGGER_SELECTOR = 'button[aria-label="Open git action menu"]';
const MENU_SELECTOR = '[role="menu"]';
const MENU_ITEM_SELECTOR = '[role="menuitem"]';
const MENU_MARK_ATTR = "data-qqrm-download-patch-menu";
const ITEM_MARK_ATTR = "data-qqrm-download-patch-item";
const DOWNLOAD_LABEL = "Download Patch";
const CAPTURE_TIMEOUT_MS = 5000;
const MESSAGE_TIMEOUT_MS = 30000;
const CLIPBOARD_HOOK_READY_TIMEOUT_MS = 1500;
const MENU_OBSERVER_WINDOW_MS = 1500;
const TRACE_PREFIX = "[download-patch]";
const MENU_LOOKUP_DELAYS_MS = [0, 50, 100, 150, 250, 400];
const CLIPBOARD_HOOK_SOURCE = "qqrm-clipboard-hook";
const CLIPBOARD_HOOK_INSTALLED_ATTR = "data-qqrm-clipboard-hook-installed";
const PATCH_DOWNLOAD_SAVE_AS = false;

type DownloadPatchResponse = { ok: true; downloadId: number } | { ok: false; error: string };
type ClipboardCaptureResult = { text: string | null; transport?: string };
type PatchSourceKind = "clipboard" | "dom-full";
type PatchAcquireResult = { text: string; source: PatchSourceKind; transport?: string };
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

export function initDownloadPatchMenuItemFeature(_ctx: FeatureContext): FeatureHandle {
  let disposed = false;
  let hookInjected = false;
  let clipboardHookReady = false;
  let activeOperationId: string | null = null;
  let clipboardHookWarmupPromise: Promise<boolean> | null = null;
  const timerIds = new Set<number>();
  const observerCleanupFns = new Set<() => void>();
  const pendingCaptures = new Map<
    string,
    { resolve: (result: ClipboardCaptureResult) => void; timeoutId: number }
  >();

  const clearTimers = () => {
    for (const id of timerIds) {
      window.clearTimeout(id);
    }
    timerIds.clear();
  };

  const clearObservers = () => {
    for (const cleanup of observerCleanupFns) {
      cleanup();
    }
    observerCleanupFns.clear();
  };

  const schedule = (fn: () => void, delayMs: number) => {
    const id = window.setTimeout(() => {
      timerIds.delete(id);
      if (disposed) return;
      fn();
    }, delayMs);
    timerIds.add(id);
  };

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

  const waitForClipboardHookReady = (timeoutMs: number): Promise<boolean> => {
    if (clipboardHookReady) return Promise.resolve(true);
    if (document.documentElement?.getAttribute(CLIPBOARD_HOOK_INSTALLED_ATTR) === "1") {
      clipboardHookReady = true;
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const onMessage = (event: MessageEvent) => {
        if (event.source !== window) return;
        const raw = event.data as unknown;
        if (!raw || typeof raw !== "object") return;
        const data = raw as { source?: string; type?: string };
        if (data.source !== CLIPBOARD_HOOK_SOURCE || data.type !== "ready") return;

        clipboardHookReady = true;
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
    if (clipboardHookReady) return;
    if (clipboardHookWarmupPromise) return;

    clipboardHookWarmupPromise = waitForClipboardHookReady(CLIPBOARD_HOOK_READY_TIMEOUT_MS)
      .catch(() => false)
      .finally(() => {
        clipboardHookWarmupPromise = null;
      });
  };

  const captureClipboardFromAction = async (
    trigger: () => void,
    traceId: string
  ): Promise<ClipboardCaptureResult> => {
    injectPageClipboardHookOnce();

    const hookReady = await waitForClipboardHookReady(CLIPBOARD_HOOK_READY_TIMEOUT_MS);
    if (!hookReady) {
      console.warn(`${TRACE_PREFIX}[${traceId}] hook ready timeout`);
      return { text: null };
    }

    console.debug(`${TRACE_PREFIX}[${traceId}] hook ready`);

    const id = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    return new Promise<ClipboardCaptureResult>((resolve) => {
      const timeoutId = window.setTimeout(() => {
        pendingCaptures.delete(id);
        resolve({ text: null });
      }, CAPTURE_TIMEOUT_MS);

      pendingCaptures.set(id, { resolve, timeoutId });
      window.postMessage(
        { source: CLIPBOARD_HOOK_SOURCE, type: "begin", id, mode: "capture-only" },
        "*"
      );

      try {
        trigger();
      } catch {
        const pending = pendingCaptures.get(id);
        if (!pending) return;
        window.clearTimeout(pending.timeoutId);
        pendingCaptures.delete(id);
        pending.resolve({ text: null });
      }
    });
  };

  const handleClipboardMessage = (event: MessageEvent) => {
    if (event.source !== window) return;
    const raw = event.data as unknown;
    if (!raw || typeof raw !== "object") return;
    const data = raw as {
      source?: string;
      type?: string;
      id?: string;
      text?: string;
      transport?: string;
    };
    if (data.source !== CLIPBOARD_HOOK_SOURCE) return;
    if (data.type === "ready") {
      clipboardHookReady = true;
      return;
    }
    if (data.type !== "captured" || !data.id) return;

    const pending = pendingCaptures.get(data.id);
    if (!pending) return;

    window.clearTimeout(pending.timeoutId);
    pendingCaptures.delete(data.id);
    pending.resolve({ text: data.text ?? null, transport: data.transport });
  };

  const handleDocumentClick = (event: MouseEvent) => {
    if (!window.location.pathname.startsWith(TASK_PATH_PREFIX)) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const trigger = target.closest(GIT_ACTION_TRIGGER_SELECTOR);
    if (!trigger) return;

    prewarmClipboardHook();

    const runLookup = () => {
      const menu = findGitActionMenu();
      if (!menu) return false;
      injectDownloadPatchItem(
        menu,
        captureClipboardFromAction,
        () => activeOperationId,
        (id) => {
          activeOperationId = id;
        }
      );
      return true;
    };

    window.requestAnimationFrame(() => {
      void runLookup();
    });

    for (const delayMs of MENU_LOOKUP_DELAYS_MS) {
      schedule(() => {
        void runLookup();
      }, delayMs);
    }

    if (!document.body) return;
    const observer = new MutationObserver(() => {
      if (runLookup()) {
        cleanup();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    const timeoutId = window.setTimeout(() => {
      cleanup();
    }, MENU_OBSERVER_WINDOW_MS);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      observer.disconnect();
      observerCleanupFns.delete(cleanup);
    };
    observerCleanupFns.add(cleanup);
  };

  document.addEventListener("click", handleDocumentClick, true);
  window.addEventListener("message", handleClipboardMessage);

  return {
    name: "downloadPatchMenuItem",
    dispose: () => {
      disposed = true;
      clearTimers();
      clearObservers();
      for (const [id, pending] of pendingCaptures.entries()) {
        window.clearTimeout(pending.timeoutId);
        pending.resolve({ text: null });
        pendingCaptures.delete(id);
      }
      document.removeEventListener("click", handleDocumentClick, true);
      window.removeEventListener("message", handleClipboardMessage);
    },
    getStatus: () => ({ active: true })
  };
}

function findGitActionMenu(): HTMLElement | null {
  const menus = Array.from(document.querySelectorAll<HTMLElement>(MENU_SELECTOR));
  for (const menu of menus) {
    const text = (menu.textContent ?? "").toLowerCase();
    const hasGitApply = text.includes("git apply");
    const hasCopyPatch = text.includes("copy") && text.includes("patch");
    const hasDraftPr = text.includes("create draft pr");
    if (hasGitApply || hasCopyPatch || hasDraftPr) {
      return menu;
    }
  }
  return null;
}

function injectDownloadPatchItem(
  menu: HTMLElement,
  captureAction: (trigger: () => void, traceId: string) => Promise<ClipboardCaptureResult>,
  getActiveOperationId: () => string | null,
  setActiveOperationId: (id: string | null) => void
) {
  if (menu.getAttribute(MENU_MARK_ATTR) === "1") return;

  const sourceItem = resolveSourceCopyMenuItem(menu);
  if (!sourceItem) return;

  const cloned = sourceItem.cloneNode(true);
  if (!(cloned instanceof HTMLElement)) return;

  const clonedItem = cloned;
  clonedItem.setAttribute(ITEM_MARK_ATTR, "1");
  clonedItem.removeAttribute("id");
  clonedItem.removeAttribute("aria-checked");
  clonedItem.removeAttribute("aria-disabled");
  clonedItem.removeAttribute("disabled");
  replaceVisibleLabel(clonedItem, DOWNLOAD_LABEL, sourceItem.textContent ?? "");
  clonedItem.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void onDownloadPatchClick(
      clonedItem,
      menu,
      captureAction,
      getActiveOperationId,
      setActiveOperationId
    );
  });

  sourceItem.insertAdjacentElement("afterend", clonedItem);
  menu.setAttribute(MENU_MARK_ATTR, "1");
}

async function onDownloadPatchClick(
  downloadItem: HTMLElement,
  menu: HTMLElement,
  captureAction: (trigger: () => void, traceId: string) => Promise<ClipboardCaptureResult>,
  getActiveOperationId: () => string | null,
  setActiveOperationId: (id: string | null) => void
) {
  const existingOperation = getActiveOperationId();
  if (existingOperation) {
    console.debug(`${TRACE_PREFIX}[${existingOperation}] operation already in progress`);
    return;
  }

  const traceId = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  setActiveOperationId(traceId);

  try {
    let sourceClickTriggered = false;
    const initialSourceItem = resolveSourceCopyMenuItem(menu);

    if (!initialSourceItem) {
      console.warn(`${TRACE_PREFIX}[${traceId}] source copy menu item not found`);
      return;
    }

    if (isDisabled(initialSourceItem)) {
      console.warn(`${TRACE_PREFIX}[${traceId}] source copy menu item is disabled`);
      return;
    }

    setMenuItemBusyState(downloadItem, true);
    console.debug(`${TRACE_PREFIX}[${traceId}] capture start`);
    const captured = await captureAction(() => {
      sourceClickTriggered = clickCurrentSourceCopyMenuItem(menu, initialSourceItem);
      if (!sourceClickTriggered) {
        console.warn(
          `${TRACE_PREFIX}[${traceId}] source copy menu item not available at click time`
        );
      }
    }, traceId);

    const normalizedCaptured = normalizePatchText(captured.text ?? "");
    if (captured.text) {
      console.info(
        `${TRACE_PREFIX}[${traceId}] capture result transport=${captured.transport ?? "unknown"} bytes=${normalizedCaptured.length}`
      );
    } else {
      console.info(`${TRACE_PREFIX}[${traceId}] capture result transport=none bytes=0`);
    }

    let patchResult: PatchAcquireResult | null = null;
    if (looksLikePatch(normalizedCaptured)) {
      patchResult = {
        text: normalizedCaptured,
        source: "clipboard",
        transport: captured.transport
      };
    } else {
      const domPatch = tryExtractFullPatchFromDom();
      if (!sourceClickTriggered) {
        console.info(
          `${TRACE_PREFIX}[${traceId}] clipboard trigger unavailable; attempting DOM fallback`
        );
      }
      if (domPatch) {
        patchResult = { text: domPatch, source: "dom-full" };
        console.info(`${TRACE_PREFIX}[${traceId}] fallback dom-full used`);
      }
    }

    if (!patchResult) {
      const reason = "Unable to capture patch content (clipboard and DOM fallback failed).";
      console.warn(`${TRACE_PREFIX}[${traceId}] ${reason}`);
      window.alert(`Download failed: ${reason}`);
      return;
    }

    const result = await requestPatchDownload({
      filename: buildPatchFilename(),
      text: patchResult.text
    });

    if (!result.ok) {
      console.warn(`${TRACE_PREFIX}[${traceId}] fail ${result.error}`);
      window.alert(`Download failed: ${result.error}`);
      return;
    }

    console.info(
      `${TRACE_PREFIX}[${traceId}] download ok id=${result.downloadId} source=${patchResult.source} transport=${patchResult.transport ?? "n/a"}`
    );
  } finally {
    setMenuItemBusyState(downloadItem, false);
    setActiveOperationId(null);
  }
}

function isDisabled(el: HTMLElement): boolean {
  if (el.hasAttribute("disabled")) return true;
  return el.getAttribute("aria-disabled") === "true";
}

function findMenuItemByText(menu: HTMLElement, pattern: RegExp): HTMLElement | null {
  const items = Array.from(menu.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR));
  for (const item of items) {
    if (item.getAttribute(ITEM_MARK_ATTR) === "1") continue;
    if (pattern.test(item.textContent ?? "")) return item;
  }
  return null;
}

function replaceVisibleLabel(item: HTMLElement, label: string, originalText: string) {
  const node = findTextNode(item, originalText.trim());
  if (node) {
    node.textContent = label;
    return;
  }

  const labelContainer =
    item.querySelector<HTMLElement>("span, div") ?? (item.lastElementChild as HTMLElement | null);
  if (labelContainer) {
    labelContainer.textContent = label;
    return;
  }

  item.textContent = label;
}

function setMenuItemBusyState(item: HTMLElement, busy: boolean) {
  const label = busy ? "Downloading Patch…" : DOWNLOAD_LABEL;
  const originalText = item.dataset.qqrmDownloadPatchOriginalText ?? item.textContent ?? "";
  if (!item.dataset.qqrmDownloadPatchOriginalText) {
    item.dataset.qqrmDownloadPatchOriginalText = originalText;
  }

  replaceVisibleLabel(item, label, busy ? DOWNLOAD_LABEL : originalText.trim());
  if (busy) {
    item.setAttribute("aria-disabled", "true");
    item.setAttribute("data-disabled", "true");
    item.style.pointerEvents = "none";
    item.style.opacity = "0.7";
  } else {
    item.removeAttribute("aria-disabled");
    item.removeAttribute("data-disabled");
    item.style.pointerEvents = "";
    item.style.opacity = "";
  }
}

function resolveSourceCopyMenuItem(menu: HTMLElement): HTMLElement | null {
  return (
    findMenuItemByText(menu, /copy\s+git\s+apply/i) ?? findMenuItemByText(menu, /copy\s+patch/i)
  );
}

function clickCurrentSourceCopyMenuItem(menu: HTMLElement, fallback: HTMLElement | null): boolean {
  const candidate = resolveSourceCopyMenuItem(menu);
  const sourceItem = candidate && candidate.isConnected ? candidate : fallback;
  if (!sourceItem || !sourceItem.isConnected || isDisabled(sourceItem)) {
    return false;
  }

  sourceItem.click();
  return true;
}

function findTextNode(root: HTMLElement, textToReplace: string): Text | null {
  if (!textToReplace) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    const text = current.textContent?.trim() ?? "";
    if (text === textToReplace) return current as Text;
    current = walker.nextNode();
  }
  return null;
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

function buildPatchFilename(): string {
  const title = findTaskTitle();
  const repo = findHeaderValue(/repo/i);
  const branch = findHeaderValue(/branch/i);

  if (!title || !repo || !branch) return "task-patch.patch";

  const slug = [title, repo, branch].map(slugify).filter(Boolean).join("-");
  if (!slug) return "task-patch.patch";
  return `${slug}.patch`;
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
