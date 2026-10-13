import { describe, expect, it, vi } from "vitest";
import { createCommandExecutor } from "../src/features/dictationCommandExecutor";
import type { Event } from "../src/features/dictationAutoSend.machine";

function setup(signal: AbortSignal) {
  const ports = {
    signal,
    now: () => 1234,
    shiftHandler: vi.fn(),
    waitForFinalText: vi.fn(async () => ({ ok: true, kind: "textarea" as const, text: "fixture" })),
    runCountdownEffect: vi.fn(async () => {}),
    updateCountdown: vi.fn(),
    hideCountdown: vi.fn(),
    stopGeneratingIfPossible: vi.fn(async () => true),
    clickSendWithAck: vi.fn(async () => true),
    tmLog: vi.fn(),
    enqueue: vi.fn(),
    step: vi.fn((_event: Event) => [])
  };
  return { ports, executor: createCommandExecutor(ports) };
}

describe("dictation command boundary", () => {
  it("uses the injected clock for completed transcription", async () => {
    const { ports, executor } = setup(new AbortController().signal);
    await executor.executeCommand({
      type: "WaitForFinalText",
      snapshot: "",
      timeoutMs: 50,
      quietMs: 10
    });
    expect(ports.step).toHaveBeenCalledWith({
      type: "FinalTextStable",
      text: "fixture",
      inputKind: "textarea",
      nowMs: 1234
    });
  });

  it("ignores an acknowledgement if cancelled while waiting", async () => {
    const controller = new AbortController();
    const { ports, executor } = setup(controller.signal);
    let finish: (value: boolean) => void = () => {};
    ports.clickSendWithAck.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        })
    );
    const pending = executor.executeCommand({ type: "ClickSendWithAck", ackTimeoutMs: 50 });
    controller.abort();
    finish(true);
    await pending;
    expect(ports.step).not.toHaveBeenCalled();
    expect(ports.enqueue).not.toHaveBeenCalled();
  });

  it("does not send after cancellation and disposes its shift listener", async () => {
    const controller = new AbortController();
    const { ports, executor } = setup(controller.signal);
    await executor.executeCommand({ type: "InstallShiftListener" });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
    expect(ports.shiftHandler).toHaveBeenCalledTimes(1);
    controller.abort();
    await executor.executeCommand({ type: "ClickSendWithAck", ackTimeoutMs: 50 });
    executor.dispose();
    executor.dispose();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
    expect(ports.shiftHandler).toHaveBeenCalledTimes(1);
    expect(ports.clickSendWithAck).not.toHaveBeenCalled();
  });
});
