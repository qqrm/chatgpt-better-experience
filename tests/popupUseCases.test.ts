import { describe, expect, it } from "vitest";
import {
  buildPopupSelectiveProjectOptions,
  loadPopupSelectiveProjects,
  loadPopupSettings,
  savePopupSelectiveProjectsPrefs,
  savePopupSettings,
  upsertPopupSelectiveProjectPref
} from "../src/application/popupUseCases";
import { AUTO_EXPAND_PROJECTS_REGISTRY_KEY } from "../src/domain/settings";
import type { StoragePort } from "../src/domain/ports/storagePort";

function makeMemoryStorage(initial: Record<string, unknown> = {}): StoragePort {
  const syncData = { ...initial };
  const localData: Record<string, unknown> = {};
  return {
    get: async <T extends Record<string, unknown>>(defaults: T) => ({
      ...defaults,
      ...(syncData as Partial<T>)
    }),
    set: async (values) => {
      Object.assign(syncData, values);
    },
    getLocal: async <T extends Record<string, unknown>>(defaults: T) => ({
      ...defaults,
      ...(localData as Partial<T>)
    }),
    setLocal: async (values) => {
      Object.assign(localData, values);
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
        showMessageTimestamps: true,
        preserveReadingPositionOnSend: true,
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
        debugTraceTarget: "timestamps"
      }
    );

    const { settings } = await loadPopupSettings({ storagePort });
    expect(settings.renameChatOnF2).toBe(false);
    expect(settings.macroRecorderEnabled).toBe(true);
    expect(settings.debugAutoExpandProjects).toBe(true);
    expect(settings.debugTraceTarget).toBe("timestamps");
    expect(settings.showMessageTimestamps).toBe(true);
    expect(settings.preserveReadingPositionOnSend).toBe(true);
  });

  it("loads and saves local-only selective project state without affecting settings flow", async () => {
    const storagePort = makeMemoryStorage({ autoExpandProjectItems: true });

    const savedPrefs = upsertPopupSelectiveProjectPref(
      {
        version: 1,
        expandedByHref: {}
      },
      "/project/orion",
      true
    );

    await storagePort.setLocal({
      [AUTO_EXPAND_PROJECTS_REGISTRY_KEY]: {
        version: 1,
        entriesByHref: {
          "/project/orion": {
            href: "/project/orion",
            title: "Orion",
            lastSeenAt: 200,
            lastSeenOrder: 0
          },
          "/project/lynx": {
            href: "/project/lynx",
            title: "Lynx",
            lastSeenAt: 100,
            lastSeenOrder: 1
          }
        }
      }
    });
    await savePopupSelectiveProjectsPrefs({ storagePort }, savedPrefs);

    const { settings } = await loadPopupSettings({ storagePort });
    const selectiveProjects = await loadPopupSelectiveProjects({ storagePort });
    const options = buildPopupSelectiveProjectOptions(
      selectiveProjects.registry,
      selectiveProjects.prefs
    );

    expect(settings.autoExpandProjectItems).toBe(true);
    expect(selectiveProjects.registry.entriesByHref["/project/orion"]?.title).toBe("Orion");
    expect(selectiveProjects.prefs.expandedByHref["/project/orion"]).toBe(true);
    expect(selectiveProjects.prefs.expandedByHref["/project/lynx"]).toBeUndefined();
    expect(options.map((option) => option.title)).toEqual(["Orion", "Lynx"]);
    expect(options.map((option) => option.expanded)).toEqual([true, false]);
  });
});
