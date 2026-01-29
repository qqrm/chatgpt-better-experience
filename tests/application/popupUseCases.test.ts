import { describe, expect, it } from "vitest";
import {
  buildAutoSendHint,
  loadPopupSettings,
  savePopupSettings
} from "../../src/application/popupUseCases";
import { SETTINGS_DEFAULTS } from "../../src/domain/settings";
import { StoragePort } from "../../src/domain/ports/storagePort";

describe("buildAutoSendHint", () => {
  it("explains enabled behavior", () => {
    const hint = buildAutoSendHint(true);
    expect(hint).toBe("Hold Shift while accepting dictation to skip auto-send.");
  });

  it("explains disabled behavior", () => {
    const hint = buildAutoSendHint(false);
    expect(hint).toBe("Auto-send is disabled.");
  });
});

describe("popup settings", () => {
  it("loads settings and normalizes defaults", async () => {
    const seeded = {
      autoSend: false,
      allowAutoSendInCodex: "nope",
      editLastMessageOnArrowUp: "nope",
      autoExpandChats: "yes",
      autoExpandProjects: "nope",
      autoTempChat: false,
      tempChatEnabled: true,
      oneClickDelete: "no",
      wideChatWidth: 42
    };
    const storagePort: StoragePort = {
      get: <T extends Record<string, unknown>>(defaults: T) =>
        Promise.resolve({ ...defaults, ...seeded } as T),
      set: () => Promise.resolve()
    };

    const { settings, hint } = await loadPopupSettings({ storagePort });

    expect(settings).toEqual({
      autoSend: false,
      allowAutoSendInCodex: SETTINGS_DEFAULTS.allowAutoSendInCodex,
      editLastMessageOnArrowUp: SETTINGS_DEFAULTS.editLastMessageOnArrowUp,
      autoExpandChats: SETTINGS_DEFAULTS.autoExpandChats,
      autoExpandProjects: SETTINGS_DEFAULTS.autoExpandProjects,
      autoTempChat: false,
      tempChatEnabled: true,
      oneClickDelete: SETTINGS_DEFAULTS.oneClickDelete,
      startDictation: SETTINGS_DEFAULTS.startDictation,
      ctrlEnterSends: SETTINGS_DEFAULTS.ctrlEnterSends,
      wideChatWidth: 42
    });
    expect(hint).toBe("Auto-send is disabled.");
  });

  it("saves settings and mirrors auto temp chat to tempChatEnabled", async () => {
    let lastPayload: Record<string, unknown> | null = null;
    const storagePort: StoragePort = {
      get: <T extends Record<string, unknown>>(defaults: T) => Promise.resolve(defaults),
      set: (values: Record<string, unknown>) => {
        lastPayload = values;
        return Promise.resolve();
      }
    };

    const input = {
      autoSend: true,
      allowAutoSendInCodex: true,
      editLastMessageOnArrowUp: true,
      autoExpandChats: false,
      autoExpandProjects: true,
      autoTempChat: true,
      oneClickDelete: true,
      startDictation: false,
      ctrlEnterSends: true,
      wideChatWidth: 70,
      enableBottomCopyButton: true,
      showOnHoverOnly: false,
      buttonSize: "M" as const,
      edgeOffsetPx: 8,
      showCopiedFeedback: true
    };

    const { hint } = await savePopupSettings({ storagePort }, input);

    expect(lastPayload).toEqual({
      ...input,
      tempChatEnabled: true
    });
    expect(hint).toBe("Hold Shift while accepting dictation to skip auto-send.");
  });
});
