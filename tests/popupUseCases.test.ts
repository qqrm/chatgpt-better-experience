import { describe, expect, it } from "vitest";
import { loadPopupSettings, savePopupSettings } from "../src/application/popupUseCases";
import type { StoragePort } from "../src/domain/ports/storagePort";

function makeMemoryStorage(initial: Record<string, unknown> = {}): StoragePort {
  const data = { ...initial };
  return {
    get: async <T extends Record<string, unknown>>(defaults: T) => ({
      ...defaults,
      ...(data as Partial<T>)
    }),
    set: async (values) => {
      Object.assign(data, values);
    }
  };
}

describe("popup use cases macroRecorderEnabled + debug traces", () => {
  it("saves and loads macroRecorderEnabled via popup settings flow", async () => {
    const storagePort = makeMemoryStorage();

    await savePopupSettings(
      { storagePort },
      {
        autoSend: true,
        allowAutoSendInCodex: true,
        downloadGitPatchesWithShiftClick: true,
        clearClipboardAfterShiftDownload: false,
        editLastMessageOnArrowUp: true,
        renameChatOnF2: false,
        autoExpandChats: true,
        autoExpandProjects: true,
        autoExpandProjectItems: false,
        autoTempChat: false,
        oneClickDelete: true,
        startDictation: false,
        ctrlEnterSends: true,
        wideChatWidth: 0,
        trimChatDom: false,
        trimChatDomKeep: 10,
        hideShareButton: false,
        macroRecorderEnabled: true,
        debugAutoExpandProjects: true,
        debugTraceTarget: "projects"
      }
    );

    const { settings } = await loadPopupSettings({ storagePort });
    expect(settings.renameChatOnF2).toBe(false);
    expect(settings.macroRecorderEnabled).toBe(true);
    expect(settings.debugAutoExpandProjects).toBe(true);
    expect(settings.debugTraceTarget).toBe("projects");
  });
});
