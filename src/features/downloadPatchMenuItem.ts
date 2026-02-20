import { FeatureContext, FeatureHandle } from "../application/featureContext";

const TASK_PATH_PREFIX = "/codex/tasks/";
const GIT_ACTION_TRIGGER_SELECTOR = 'button[aria-label="Open git action menu"]';
const MENU_SELECTOR = '[role="menu"]';
const MENU_ITEM_SELECTOR = '[role="menuitem"]';
const MENU_MARK_ATTR = "data-qqrm-download-patch-menu";
const ITEM_MARK_ATTR = "data-qqrm-download-patch-item";
const DOWNLOAD_LABEL = "Download Patch";
const CAPTURE_TIMEOUT_MS = 2000;
const MENU_LOOKUP_DELAYS_MS = [0, 50, 100, 150, 250, 400];
const CLIPBOARD_HOOK_SOURCE = "qqrm-clipboard-hook";

export function initDownloadPatchMenuItemFeature(_ctx: FeatureContext): FeatureHandle {
  let disposed = false;
  let hookInjected = false;
  const timerIds = new Set<number>();
  const pendingCaptures = new Map<
    string,
    { resolve: (text: string | null) => void; timeoutId: number }
  >();

  const clearTimers = () => {
    for (const id of timerIds) {
      window.clearTimeout(id);
    }
    timerIds.clear();
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

  const captureClipboardFromAction = (trigger: () => void): Promise<string | null> => {
    injectPageClipboardHookOnce();

    const id = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    return new Promise<string | null>((resolve) => {
      const timeoutId = window.setTimeout(() => {
        pendingCaptures.delete(id);
        resolve(null);
      }, CAPTURE_TIMEOUT_MS);

      pendingCaptures.set(id, { resolve, timeoutId });
      window.postMessage({ source: CLIPBOARD_HOOK_SOURCE, type: "begin", id }, "*");

      try {
        trigger();
      } catch {
        const pending = pendingCaptures.get(id);
        if (!pending) return;
        window.clearTimeout(pending.timeoutId);
        pendingCaptures.delete(id);
        pending.resolve(null);
      }
    });
  };

  const handleClipboardMessage = (event: MessageEvent) => {
    if (event.source !== window) return;
    const raw = event.data as unknown;
    if (!raw || typeof raw !== "object") return;
    const data = raw as { source?: string; type?: string; id?: string; text?: string };
    if (data.source !== CLIPBOARD_HOOK_SOURCE || data.type !== "captured" || !data.id) return;

    const pending = pendingCaptures.get(data.id);
    if (!pending) return;

    window.clearTimeout(pending.timeoutId);
    pendingCaptures.delete(data.id);
    pending.resolve(data.text ?? null);
  };

  const handleDocumentClick = (event: MouseEvent) => {
    if (!window.location.pathname.startsWith(TASK_PATH_PREFIX)) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const trigger = target.closest(GIT_ACTION_TRIGGER_SELECTOR);
    if (!trigger) return;

    const runLookup = () => {
      const menu = findGitActionMenu();
      if (!menu) return;
      injectDownloadPatchItem(menu, captureClipboardFromAction);
    };

    window.requestAnimationFrame(runLookup);
    for (const delayMs of MENU_LOOKUP_DELAYS_MS) {
      schedule(runLookup, delayMs);
    }
  };

  document.addEventListener("click", handleDocumentClick, true);
  window.addEventListener("message", handleClipboardMessage);

  return {
    name: "downloadPatchMenuItem",
    dispose: () => {
      disposed = true;
      clearTimers();
      for (const [id, pending] of pendingCaptures.entries()) {
        window.clearTimeout(pending.timeoutId);
        pending.resolve(null);
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
  captureAction: (trigger: () => void) => Promise<string | null>
) {
  if (menu.getAttribute(MENU_MARK_ATTR) === "1") return;

  const sourceItem =
    findMenuItemByText(menu, /copy\s+git\s+apply/i) ?? findMenuItemByText(menu, /copy\s+patch/i);
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
    void onDownloadPatchClick(menu, captureAction);
  });

  sourceItem.insertAdjacentElement("afterend", clonedItem);
  menu.setAttribute(MENU_MARK_ATTR, "1");
}

async function onDownloadPatchClick(
  menu: HTMLElement,
  captureAction: (trigger: () => void) => Promise<string | null>
) {
  const sourceItem =
    findMenuItemByText(menu, /copy\s+git\s+apply/i) ?? findMenuItemByText(menu, /copy\s+patch/i);

  if (!sourceItem) {
    console.warn("[download-patch] Source copy menu item not found.");
    return;
  }

  if (isDisabled(sourceItem)) {
    console.warn("[download-patch] Source copy menu item is disabled.");
    return;
  }

  const patchText = await captureAction(() => {
    sourceItem.click();
  });

  if (!patchText || !patchText.trim()) {
    console.warn("[download-patch] Unable to capture patch content.");
    return;
  }

  downloadTextAsFile(patchText, buildPatchFilename());
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

function downloadTextAsFile(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
