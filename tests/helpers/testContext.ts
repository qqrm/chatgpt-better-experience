import type { FeatureContext, Logger } from "../../src/application/featureContext";
import type { Settings } from "../../src/domain/settings";
import type { StoragePort } from "../../src/domain/ports/storagePort";

const noopLogger: Logger = {
  isEnabled: false,
  debug: () => {}
};

const noopStoragePort: StoragePort = {
  get: async <T extends Record<string, unknown>>(defaults: T): Promise<T> => defaults,
  set: async () => {}
};

export function makeTestContext(settings: Partial<Settings> = {}): FeatureContext {
  const merged: Settings = {
    autoSend: false,
    allowAutoSendInCodex: false,
    editLastMessageOnArrowUp: false,
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
    ...settings
  };

  return {
    settings: merged,
    storagePort: noopStoragePort,
    logger: noopLogger,
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
      safeQuery: <T extends Element = Element>(
        sel: string,
        root: Document | Element = document
      ) => {
        return root.querySelector(sel) as T | null;
      }
    }
  };
}
