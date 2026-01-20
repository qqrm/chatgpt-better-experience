import { describe, expect, it } from "vitest";
import { SETTINGS_DEFAULTS } from "../settings";
import { isElementVisible, isVisible, norm, normalizeSettings } from "../src/lib/utils";

describe("utils", () => {
  it("normalizes strings to lowercase", () => {
    expect(norm("HeLLo")).toBe("hello");
    expect(norm(null)).toBe("");
  });

  it("normalizes settings with defaults", () => {
    const input = {
      autoSend: false,
      allowAutoSendInCodex: "no",
      editLastMessageOnArrowUp: "no",
      autoExpandChats: "no",
      autoTempChat: false,
      tempChatEnabled: "yes",
      oneClickDelete: "no",
      wideChatWidth: 120
    } as Record<string, unknown>;

    const normalized = normalizeSettings(input);

    expect(normalized).toEqual({
      autoSend: false,
      allowAutoSendInCodex: SETTINGS_DEFAULTS.allowAutoSendInCodex,
      editLastMessageOnArrowUp: SETTINGS_DEFAULTS.editLastMessageOnArrowUp,
      autoExpandChats: SETTINGS_DEFAULTS.autoExpandChats,
      autoTempChat: false,
      tempChatEnabled: SETTINGS_DEFAULTS.tempChatEnabled,
      oneClickDelete: SETTINGS_DEFAULTS.oneClickDelete,
      startDictation: SETTINGS_DEFAULTS.startDictation,
      ctrlEnterSends: SETTINGS_DEFAULTS.ctrlEnterSends,
      wideChatWidth: 100
    });
  });

  it("falls back to defaults for non-finite width values", () => {
    const input = {
      wideChatWidth: Number.NaN
    } as Record<string, unknown>;

    const normalized = normalizeSettings(input);

    expect(normalized.wideChatWidth).toBe(SETTINGS_DEFAULTS.wideChatWidth);
  });

  it("checks visibility based on bounding box", () => {
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ width: 10, height: 10 }) as DOMRect;

    expect(isVisible(null)).toBe(false);
    expect(isVisible(el)).toBe(true);
  });

  it("checks element visibility using styles", () => {
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ width: 10, height: 10 }) as DOMRect;
    document.body.appendChild(el);

    expect(isElementVisible(el)).toBe(true);

    el.style.display = "none";
    expect(isElementVisible(el)).toBe(false);

    el.style.display = "block";
    el.style.visibility = "hidden";
    expect(isElementVisible(el)).toBe(false);

    el.style.visibility = "visible";
    el.style.opacity = "0";
    expect(isElementVisible(el)).toBe(false);

    el.remove();
  });
});
