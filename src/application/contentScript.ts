import { SETTINGS_DEFAULTS } from "../domain/settings";
import { StoragePort } from "../domain/ports/storagePort";
import { normalizeSettings } from "../lib/utils";
import { createFeatureContext, FeatureHandle } from "./featureContext";
import { initDictationAutoSendFeature } from "../features/dictationAutoSend";
import { initEditLastMessageFeature } from "../features/editLastMessage";
import { initOneClickDeleteFeature } from "../features/oneClickDelete";
import { initAutoTempChatFeature } from "../features/autoTempChat";
import { initAutoExpandChatsFeature } from "../features/autoExpandChats";
import { initWideChatFeature } from "../features/wideChat";
import { initCtrlEnterSendFeature } from "../features/ctrlEnterSend";

declare global {
  interface Window {
    __ChatGPTDictationAutoSendLoaded__?: boolean;
  }
}

export interface ContentScriptDeps {
  storagePort?: StoragePort | null;
}

const fallbackStoragePort: StoragePort = {
  get: (defaults) => Promise.resolve({ ...defaults }),
  set: () => Promise.resolve()
};

export const startContentScript = ({ storagePort }: ContentScriptDeps = {}) => {
  if (window.__ChatGPTDictationAutoSendLoaded__) return;
  window.__ChatGPTDictationAutoSendLoaded__ = true;

  const resolvedStorage = storagePort ?? fallbackStoragePort;

  const DEBUG = false;

  const loadSettings = async () => {
    const stored = await resolvedStorage.get(SETTINGS_DEFAULTS);
    return normalizeSettings(stored);
  };

  const init = async () => {
    const settings = await loadSettings();
    const ctx = createFeatureContext({
      settings,
      storagePort: resolvedStorage,
      debugEnabled: DEBUG
    });

    const features: FeatureHandle[] = [
      initDictationAutoSendFeature(ctx),
      initEditLastMessageFeature(ctx),
      initAutoExpandChatsFeature(ctx),
      initAutoTempChatFeature(ctx),
      initOneClickDeleteFeature(ctx),
      initWideChatFeature(ctx),
      initCtrlEnterSendFeature(ctx)
    ];

    if (ctx.logger.isEnabled) {
      const summary = features
        .map((feature) => {
          const status = feature.getStatus?.();
          const state = status?.active ? "on" : "off";
          const details = status?.details ? `:${status.details}` : "";
          return `${feature.name}=${state}${details}`;
        })
        .join(", ");
      ctx.logger.debug("BOOT", "features initialized", { preview: summary });
    }

    const handleStorageChange = (
      changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
      areaName: string
    ) => {
      if (areaName !== "sync" && areaName !== "local") return;
      if (
        !changes ||
        (!("autoExpandChats" in changes) &&
          !("autoSend" in changes) &&
          !("allowAutoSendInCodex" in changes) &&
          !("editLastMessageOnArrowUp" in changes) &&
          !("autoTempChat" in changes) &&
          !("oneClickDelete" in changes) &&
          !("startDictation" in changes) &&
          !("ctrlEnterSends" in changes) &&
          !("wideChatWidth" in changes) &&
          !("tempChatEnabled" in changes))
      ) {
        return;
      }
      void (async () => {
        const nextSettings = await loadSettings();
        const previousSettings = { ...ctx.settings };
        Object.assign(ctx.settings, nextSettings);
        for (const handle of features) {
          handle.onSettingsChange?.(ctx.settings, previousSettings);
        }
      })();
    };

    resolvedStorage.onChanged?.(handleStorageChange);
  };

  void init();
};
