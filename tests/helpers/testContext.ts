import type { FeatureContext, Logger } from "../../src/application/featureContext";
import type { Settings } from "../../src/domain/settings";
import type { StoragePort } from "../../src/domain/ports/storagePort";
import type { DomDelta } from "../../src/application/domEventBus";

const noopLogger: Logger = {
  isEnabled: false,
  debug: () => {},
  isTraceEnabled: () => false,
  trace: () => {},
  contractSnapshot: () => {}
};

const noopStoragePort: StoragePort = {
  get: async <T extends Record<string, unknown>>(defaults: T): Promise<T> => defaults,
  set: async () => {}
};

export function makeTestContext(settings: Partial<Settings> = {}): FeatureContext {
  const merged: Settings = {
    autoSend: false,
    allowAutoSendInCodex: false,
    downloadGitPatchesWithShiftClick: false,
    clearClipboardAfterShiftDownload: false,
    editLastMessageOnArrowUp: false,
    renameChatOnF2: false,
    autoExpandChats: false,
    autoExpandProjects: false,
    autoExpandProjectItems: false,
    autoTempChat: false,
    tempChatEnabled: false,
    oneClickDelete: false,
    startDictation: false,
    ctrlEnterSends: false,
    wideChatWidth: 0,
    trimChatDom: false,
    trimChatDomKeep: 10,
    hideShareButton: false,
    macroRecorderEnabled: false,
    debugAutoExpandProjects: false,
    debugTraceTarget: "projects",
    ...settings
  };

  return {
    settings: merged,
    storagePort: noopStoragePort,
    logger: noopLogger,
    domBus: {
      start: () => {},
      stop: () => {},
      dispose: () => {},
      getMainRoot: () => document.querySelector('main, [role="main"]'),
      getNavRoot: () => document.querySelector('nav[aria-label="Chat history"]'),
      onDelta: (_channel: "main" | "nav", _cb: (delta: DomDelta) => void) => () => {},
      onRoots: (_cb) => () => {},
      getStats: () => ({
        startedAt: 0,
        channelMutations: { main: 0, nav: 0 },
        emits: { main: 0, nav: 0 },
        rebinds: 0,
        disconnects: { main: 0, nav: 0 },
        lastEmitAt: 0,
        started: false,
        disposed: false,
        mainSubs: 0,
        navSubs: 0,
        rootSubs: 0
      }),
      stats: () => ({
        mainObserverCalls: 0,
        navObserverCalls: 0,
        mainNodes: 0,
        navNodes: 0,
        emits: 0,
        rebinds: 0
      })
    },
    keyState: { shift: false, ctrl: false, alt: false },
    helpers: {
      waitPresent: async () => null,
      waitGone: async () => true,
      humanClick: () => true,
      debounceScheduler: (fn: () => void, delayMs: number) => {
        let t: number | null = null;
        return {
          schedule: () => {
            if (t !== null) window.clearTimeout(t);
            t = window.setTimeout(fn, delayMs);
          },
          cancel: () => {
            if (t !== null) window.clearTimeout(t);
            t = null;
          }
        };
      },
      createRafScheduler: (fn: () => void) => {
        let frame: number | null = null;
        return {
          schedule: () => {
            if (frame !== null) return;
            frame = window.requestAnimationFrame(() => {
              frame = null;
              fn();
            });
          },
          cancel: () => {
            if (frame === null) return;
            window.cancelAnimationFrame(frame);
            frame = null;
          }
        };
      },
      observe: (
        root: Element,
        cb: (records: MutationRecord[]) => void,
        options?: MutationObserverInit
      ) => {
        const observer = new MutationObserver((records) => cb(records));
        observer.observe(root, options ?? { childList: true, subtree: true });
        return { observer, disconnect: () => observer.disconnect() };
      },
      extractAddedElements: (records: MutationRecord[]) => {
        const out: Element[] = [];
        for (const record of records) {
          if (record.type !== "childList") continue;
          for (const node of Array.from(record.addedNodes)) {
            if (node instanceof Element) out.push(node);
          }
        }
        return out;
      },
      onPathChange: () => () => {},
      safeQuery: <T extends Element = Element>(
        sel: string,
        root: Document | Element = document
      ) => {
        return root.querySelector(sel) as T | null;
      }
    }
  };
}
