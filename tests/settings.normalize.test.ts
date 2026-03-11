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

describe("normalizeSettings conversation enhancements", () => {
  it("defaults timestamps and scroll preservation to true", () => {
    const settings = normalizeSettings({});
    expect(settings.showMessageTimestamps).toBe(true);
    expect(settings.preserveReadingPositionOnSend).toBe(true);
  });

  it("parses timestamps and scroll preservation booleans", () => {
    expect(normalizeSettings({ showMessageTimestamps: false }).showMessageTimestamps).toBe(false);
    expect(
      normalizeSettings({ preserveReadingPositionOnSend: false }).preserveReadingPositionOnSend
    ).toBe(false);
    expect(normalizeSettings({ showMessageTimestamps: "false" }).showMessageTimestamps).toBe(true);
  });
});

describe("normalizeSettings debugTraceTarget", () => {
  it("accepts autoSend target", () => {
    expect(normalizeSettings({ debugTraceTarget: "autoSend" }).debugTraceTarget).toBe("autoSend");
  });
});
