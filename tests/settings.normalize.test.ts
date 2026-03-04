import { describe, expect, it } from "vitest";
import { normalizeSettings } from "../src/lib/utils";

describe("normalizeSettings macroRecorderEnabled", () => {
  it("defaults macroRecorderEnabled to false", () => {
    const settings = normalizeSettings({});
    expect(settings.macroRecorderEnabled).toBe(false);
  });

  it("parses macroRecorderEnabled boolean values", () => {
    expect(normalizeSettings({ macroRecorderEnabled: true }).macroRecorderEnabled).toBe(true);
    expect(normalizeSettings({ macroRecorderEnabled: false }).macroRecorderEnabled).toBe(false);
    expect(normalizeSettings({ macroRecorderEnabled: "true" }).macroRecorderEnabled).toBe(false);
  });
});

describe("normalizeSettings renameChatOnF2", () => {
  it("defaults renameChatOnF2 to true", () => {
    const settings = normalizeSettings({});
    expect(settings.renameChatOnF2).toBe(true);
  });

  it("parses renameChatOnF2 boolean values", () => {
    expect(normalizeSettings({ renameChatOnF2: true }).renameChatOnF2).toBe(true);
    expect(normalizeSettings({ renameChatOnF2: false }).renameChatOnF2).toBe(false);
    expect(normalizeSettings({ renameChatOnF2: "false" }).renameChatOnF2).toBe(true);
  });
});

describe("normalizeSettings debugTraceTarget", () => {
  it("accepts autoSend target", () => {
    expect(normalizeSettings({ debugTraceTarget: "autoSend" }).debugTraceTarget).toBe("autoSend");
  });
});
