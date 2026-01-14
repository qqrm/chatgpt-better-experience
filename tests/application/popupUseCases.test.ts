import { describe, expect, it } from "vitest";
import {
  buildAutoSendHint,
  loadPopupSettings,
  savePopupSettings
} from "../../src/application/popupUseCases";
import { SETTINGS_DEFAULTS, SettingsRecord } from "../../src/domain/settings";
import { StoragePort } from "../../src/domain/ports/storagePort";

describe("buildAutoSendHint", () => {
  it("explains always-on behavior when no modifier is selected", () => {
    const hint = buildAutoSendHint("None", false);
    expect(hint).toBe("Auto-send always happens when you accept dictation.");
  });

  it("explains disabled behavior when hold-to-send is enabled without a modifier", () => {
    const hint = buildAutoSendHint("None", true);
    expect(hint).toBe("Auto-send is disabled because no modifier key is selected.");
  });

  it("explains hold-to-send behavior for a modifier", () => {
    const hint = buildAutoSendHint("Shift", true);
    expect(hint).toBe("Auto-send happens only while holding Shift when you accept dictation.");
  });
});

describe("popup settings", () => {
  it("loads settings and normalizes defaults", async () => {
    const seeded = {
      skipKey: "Alt",
      holdToSend: true,
      allowAutoSendInCodex: "nope",
      editLastMessageOnArrowUp: "nope",
      autoExpandChats: "yes",
      autoTempChat: false,
      tempChatEnabled: true,
      oneClickDelete: "no",
      wideChatWidth: 42
    };
    const storagePort: StoragePort = {
      get: <T extends SettingsRecord>(defaults: T) =>
        Promise.resolve({ ...defaults, ...seeded } as T),
      set: () => Promise.resolve()
    };

    const { settings, hint } = await loadPopupSettings({ storagePort });

    expect(settings).toEqual({
      skipKey: "Alt",
      holdToSend: true,
      allowAutoSendInCodex: SETTINGS_DEFAULTS.allowAutoSendInCodex,
      editLastMessageOnArrowUp: SETTINGS_DEFAULTS.editLastMessageOnArrowUp,
      autoExpandChats: SETTINGS_DEFAULTS.autoExpandChats,
      autoTempChat: false,
      tempChatEnabled: true,
      oneClickDelete: SETTINGS_DEFAULTS.oneClickDelete,
      wideChatWidth: 42,
      enableBottomCopyButton: SETTINGS_DEFAULTS.enableBottomCopyButton,
      showOnHoverOnly: SETTINGS_DEFAULTS.showOnHoverOnly,
      buttonSize: SETTINGS_DEFAULTS.buttonSize,
      edgeOffsetPx: SETTINGS_DEFAULTS.edgeOffsetPx,
      showCopiedFeedback: SETTINGS_DEFAULTS.showCopiedFeedback
    });
    expect(hint).toBe("Auto-send happens only while holding Alt when you accept dictation.");
  });

  it("saves settings and mirrors auto temp chat to tempChatEnabled", async () => {
    let lastPayload: Record<string, unknown> | null = null;
    const storagePort: StoragePort = {
      get: <T extends SettingsRecord>(defaults: T) => Promise.resolve(defaults),
      set: (values: Record<string, unknown>) => {
        lastPayload = values;
        return Promise.resolve();
      }
    };

    const input = {
      skipKey: "Shift",
      holdToSend: false,
      allowAutoSendInCodex: true,
      editLastMessageOnArrowUp: true,
      autoExpandChats: false,
      autoTempChat: true,
      oneClickDelete: true,
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
