import { describe, expect, it } from "vitest";
import { routeKeyCombos } from "../../src/features/keyCombos";

describe("key combos", () => {
  it("routes higher priority combos first", () => {
    let called = "";
    const event = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true });

    routeKeyCombos(event, [
      { key: "Enter", ctrl: true, priority: 1, handler: () => (called = "low") },
      { key: "Enter", ctrl: true, priority: 5, handler: () => (called = "high") }
    ]);

    expect(called).toBe("high");
  });

  it("avoids conflicts between ctrl/meta and plain combos", () => {
    let ctrl = 0;
    let plain = 0;
    const event = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true });

    routeKeyCombos(event, [
      { key: "Enter", ctrl: true, priority: 2, handler: () => (ctrl += 1) },
      { key: "Enter", ctrl: false, meta: false, priority: 1, handler: () => (plain += 1) }
    ]);

    expect(ctrl).toBe(1);
    expect(plain).toBe(0);
  });

  it("matches plain combos when modifiers are absent", () => {
    let plain = 0;
    const event = new KeyboardEvent("keydown", { key: "Enter" });

    routeKeyCombos(event, [
      { key: "Enter", ctrl: false, meta: false, handler: () => (plain += 1) }
    ]);

    expect(plain).toBe(1);
  });
});
