import { beforeEach, describe, expect, it } from "vitest";
import { makeMacroRecorderHarness } from "./helpers/macroRecorderHarness";

describe("macroRecorder feature", () => {
  beforeEach(() => {
    document.body.innerHTML = "<button id='x'>Click</button>";
  });

  it("does nothing on Ctrl+Shift+F8 while disabled", () => {
    const h = makeMacroRecorderHarness(false);

    const event = h.pressToggle();

    expect(event.defaultPrevented).toBe(false);
    expect(h.fx.rrwebStarts).toHaveLength(0);
    expect(h.storageWrites).toHaveLength(0);

    h.dispose();
  });

  it("handles toggle while typing in editable targets", () => {
    const h = makeMacroRecorderHarness(true);
    const input = document.createElement("input");
    document.body.appendChild(input);

    const event = h.pressToggle(input);

    expect(event.defaultPrevented).toBe(true);
    expect(h.fx.rrwebStarts).toHaveLength(1);
    expect(h.storageWrites.some((w) => w.macroRecorderStatus === "recording")).toBe(true);
    expect(h.fx.toasts[h.fx.toasts.length - 1]?.message).toBe("Macro recording started");

    h.dispose();
  });

  it("starts recording on first Ctrl+Shift+F8 press", () => {
    const h = makeMacroRecorderHarness(true);

    const event = h.pressToggle();

    expect(event.defaultPrevented).toBe(true);
    expect(h.fx.rrwebStarts).toHaveLength(1);
    expect(h.handle.getStatus?.().details).toBe("recording");
    expect(h.storageWrites.some((w) => w.macroRecorderStatus === "recording")).toBe(true);
    expect(h.fx.toasts[h.fx.toasts.length - 1]).toEqual({
      message: "Macro recording started",
      tone: "active"
    });

    h.dispose();
  });

  it("stops and exports on second Ctrl+Shift+F8 press", () => {
    const h = makeMacroRecorderHarness(true);

    const startEvent = h.pressToggle();
    const stopEvent = h.pressToggle();

    expect(startEvent.defaultPrevented).toBe(true);
    expect(stopEvent.defaultPrevented).toBe(true);
    expect(h.fx.rrwebStarts).toHaveLength(1);
    expect(h.fx.rrwebStopCalls).toBe(1);
    expect(h.handle.getStatus?.().details).toBe("ready");
    expect(h.fx.toasts[h.fx.toasts.length - 1]?.message).toBe("Macro recording saved");
    expect(h.fx.downloads).toHaveLength(1);
    expect(h.storageWrites.some((w) => "macroRecorderLastExportAt" in w)).toBe(true);

    const payload = h.fx.downloads[0]?.payload as {
      schemaVersion: number;
      rrwebEvents: unknown[];
      actions: unknown[];
    };
    expect(payload.schemaVersion).toBe(1);
    expect(Array.isArray(payload.rrwebEvents)).toBe(true);
    expect(Array.isArray(payload.actions)).toBe(true);

    h.dispose();
  });

  it("is idempotent for repeated stop-intent presses", () => {
    const h = makeMacroRecorderHarness(true);

    h.pressToggle();
    h.pressToggle();
    h.pressToggle(undefined, { repeat: true });

    expect(h.fx.rrwebStarts).toHaveLength(1);
    expect(h.fx.rrwebStopCalls).toBe(1);
    expect(h.fx.downloads).toHaveLength(1);

    h.dispose();
  });

  it("exports contract-compatible payload", () => {
    const h = makeMacroRecorderHarness(true);

    h.pressToggle();
    h.fx.emitRrweb({ type: 0, timestamp: 1700000000500, data: {} as never });

    const input = document.createElement("input");
    input.id = "prompt-input";
    input.value = "hello";
    document.body.appendChild(input);
    input.dispatchEvent(new Event("input", { bubbles: true }));

    h.pressToggle();

    const exported = h.fx.downloads[0]?.payload as {
      schemaVersion: number;
      rrwebEvents: Array<{ timestamp?: number }>;
      actions: Array<{ t: number; kind: string; selector?: string }>;
      meta: { durationMs: number };
    };

    expect(exported.schemaVersion).toBe(1);
    expect(Array.isArray(exported.rrwebEvents)).toBe(true);
    expect(Array.isArray(exported.actions)).toBe(true);
    expect(exported.meta.durationMs).toBeGreaterThanOrEqual(0);

    for (const action of exported.actions) {
      expect(["click", "input", "keydown"]).toContain(action.kind);
      if (action.kind === "click" || action.kind === "input") {
        expect(typeof action.selector).toBe("string");
        expect(action.selector?.length).toBeGreaterThan(0);
      }
    }

    for (let i = 1; i < exported.actions.length; i += 1) {
      expect(exported.actions[i]!.t).toBeGreaterThanOrEqual(exported.actions[i - 1]!.t);
    }

    h.dispose();
  });
});
