import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestContext } from "./helpers/testContext";

const { recordMock } = vi.hoisted(() => ({
  recordMock: vi.fn()
}));

vi.mock("@rrweb/record", () => ({
  record: recordMock
}));

import { initMacroRecorderFeature } from "../src/features/macroRecorder";

type StorageWrite = Record<string, unknown>;

function makeStorageCapture() {
  const writes: StorageWrite[] = [];
  return {
    writes,
    set: async (values: StorageWrite) => {
      writes.push(values);
    }
  };
}

function keydown(key: string, options: KeyboardEventInit & { target?: EventTarget } = {}) {
  const { target, ...init } = options;
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init
  });

  if (target instanceof EventTarget) {
    target.dispatchEvent(event);
  } else {
    window.dispatchEvent(event);
  }

  return event;
}

describe("macroRecorder feature", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    recordMock.mockReset();
    recordMock.mockImplementation(() => vi.fn());
    document.body.innerHTML = "<button id='x'>Click</button>";
  });

  it("does nothing on Ctrl+Shift+F8 while disabled", () => {
    const storage = makeStorageCapture();
    const ctx = makeTestContext({ macroRecorderEnabled: false });
    ctx.storagePort.set = storage.set;

    const handle = initMacroRecorderFeature(ctx);

    const event = keydown("F8", { ctrlKey: true, shiftKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(recordMock).not.toHaveBeenCalled();
    expect(storage.writes.length).toBe(0);

    handle.dispose();
  });

  it("handles toggle while typing in editable targets", () => {
    const storage = makeStorageCapture();
    const ctx = makeTestContext({ macroRecorderEnabled: true });
    ctx.storagePort.set = storage.set;

    const input = document.createElement("input");
    document.body.appendChild(input);

    const handle = initMacroRecorderFeature(ctx);

    const event = keydown("F8", { ctrlKey: true, shiftKey: true, target: input });

    expect(event.defaultPrevented).toBe(true);
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(storage.writes.some((w) => w.macroRecorderStatus === "recording")).toBe(true);
    expect(document.getElementById("qqrm-macro-recorder-toast")?.textContent).toBe(
      "Macro recording started"
    );

    handle.dispose();
  });

  it("starts recording on first Ctrl+Shift+F8 press", () => {
    const storage = makeStorageCapture();
    const ctx = makeTestContext({ macroRecorderEnabled: true });
    ctx.storagePort.set = storage.set;

    const handle = initMacroRecorderFeature(ctx);

    const event = keydown("F8", { ctrlKey: true, shiftKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(handle.getStatus?.().details).toBe("recording");
    expect(storage.writes.some((w) => w.macroRecorderStatus === "recording")).toBe(true);
    expect(document.getElementById("qqrm-macro-recorder-toast")?.textContent).toBe(
      "Macro recording started"
    );

    handle.dispose();
  });

  it("stops and exports on second Ctrl+Shift+F8 press", async () => {
    const storage = makeStorageCapture();
    const stopFn = vi.fn();
    recordMock.mockImplementation(() => stopFn);

    const createObjectUrlSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation(() => "blob:test");
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const anchorClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    const ctx = makeTestContext({ macroRecorderEnabled: true });
    ctx.storagePort.set = storage.set;
    const handle = initMacroRecorderFeature(ctx);

    const startEvent = keydown("F8", { ctrlKey: true, shiftKey: true });
    const stopEvent = keydown("F8", { ctrlKey: true, shiftKey: true });

    expect(startEvent.defaultPrevented).toBe(true);
    expect(stopEvent.defaultPrevented).toBe(true);
    expect(stopFn).toHaveBeenCalledTimes(1);
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(handle.getStatus?.().details).toBe("ready");
    expect(document.getElementById("qqrm-macro-recorder-toast")?.textContent).toBe(
      "Macro recording saved"
    );

    const exportWrites = storage.writes.filter((w) => "macroRecorderLastExportAt" in w);
    expect(exportWrites.length).toBe(1);

    const blob = createObjectUrlSpy.mock.calls[0]?.[0] as Blob;
    const payload = JSON.parse(await blob.text()) as {
      rrwebEvents: unknown[];
      actions: unknown[];
      schemaVersion: number;
    };
    expect(payload.schemaVersion).toBe(1);
    expect(Array.isArray(payload.rrwebEvents)).toBe(true);
    expect(Array.isArray(payload.actions)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(revokeSpy).toHaveBeenCalled();

    handle.dispose();
  });

  it("is idempotent for repeated stop-intent presses", () => {
    const storage = makeStorageCapture();
    const stopFn = vi.fn();
    recordMock.mockImplementation(() => stopFn);

    const anchorClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    const ctx = makeTestContext({ macroRecorderEnabled: true });
    ctx.storagePort.set = storage.set;
    const handle = initMacroRecorderFeature(ctx);

    keydown("F8", { ctrlKey: true, shiftKey: true });
    keydown("F8", { ctrlKey: true, shiftKey: true });
    keydown("F8", { ctrlKey: true, shiftKey: true, repeat: true });

    expect(stopFn).toHaveBeenCalledTimes(1);
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledTimes(1);

    handle.dispose();
  });
});
