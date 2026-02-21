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

function keydown(key: string) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true
  });
  window.dispatchEvent(event);
  return event;
}

describe("macroRecorder feature", () => {
  beforeEach(() => {
    recordMock.mockReset();
    recordMock.mockImplementation(() => vi.fn());
    document.body.innerHTML = "<button id='x'>Click</button>";
  });

  it("does nothing on F5/F6 while disabled", () => {
    const storage = makeStorageCapture();
    const ctx = makeTestContext({ macroRecorderEnabled: false });
    ctx.storagePort.set = storage.set;

    const handle = initMacroRecorderFeature(ctx);

    const startEvent = keydown("F5");
    const stopEvent = keydown("F6");

    expect(startEvent.defaultPrevented).toBe(false);
    expect(stopEvent.defaultPrevented).toBe(false);
    expect(recordMock).not.toHaveBeenCalled();
    expect(storage.writes.length).toBe(0);

    handle.dispose();
  });

  it("does not handle F5/F6 while typing in editable targets", () => {
    const storage = makeStorageCapture();
    const ctx = makeTestContext({ macroRecorderEnabled: true });
    ctx.storagePort.set = storage.set;

    const input = document.createElement("input");
    document.body.appendChild(input);

    const handle = initMacroRecorderFeature(ctx);

    const startEvent = new KeyboardEvent("keydown", { key: "F5", bubbles: true, cancelable: true });
    input.dispatchEvent(startEvent);
    const stopEvent = new KeyboardEvent("keydown", { key: "F6", bubbles: true, cancelable: true });
    input.dispatchEvent(stopEvent);

    expect(startEvent.defaultPrevented).toBe(false);
    expect(stopEvent.defaultPrevented).toBe(false);
    expect(recordMock).not.toHaveBeenCalled();
    expect(storage.writes.length).toBe(0);

    handle.dispose();
  });

  it("enters recording on F5 when enabled", () => {
    const storage = makeStorageCapture();
    const ctx = makeTestContext({ macroRecorderEnabled: true });
    ctx.storagePort.set = storage.set;

    const handle = initMacroRecorderFeature(ctx);

    const event = keydown("F5");

    expect(event.defaultPrevented).toBe(true);
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(handle.getStatus?.().details).toBe("recording");
    expect(storage.writes.some((w) => w.macroRecorderStatus === "recording")).toBe(true);

    handle.dispose();
  });

  it("F6 after recording stops, exports once, and is idempotent on repeated F6", async () => {
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

    keydown("F5");
    const stopEvent = keydown("F6");
    const secondStopEvent = keydown("F6");

    expect(stopEvent.defaultPrevented).toBe(true);
    expect(secondStopEvent.defaultPrevented).toBe(true);
    expect(stopFn).toHaveBeenCalledTimes(1);
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(handle.getStatus?.().details).toBe("ready");

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
});
