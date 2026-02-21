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
