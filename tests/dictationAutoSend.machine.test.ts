import { describe, expect, it } from "vitest";
import {
  initialState,
  type MachineConfig,
  reducer,
  type State
} from "../src/features/dictationAutoSend.machine";

const cfg: MachineConfig = {
  autoSendDelayMs: 3000,
  finalTextTimeoutMs: 25000,
  finalTextQuietMs: 320,
  sendAckTimeoutMs: 4500
};

const submitEvent = {
  type: "SubmitClicked" as const,
  shiftKey: false,
  isCodexPath: false,
  allowInCodex: true,
  snapshot: ""
};

describe("dictationAutoSend.machine", () => {
  it("runs submit -> await final -> countdown -> send -> done", () => {
    let state: State = initialState;

    let result = reducer(state, submitEvent, cfg);
    state = result.state;
    expect(state.kind).toBe("AwaitFinalText");

    result = reducer(
      state,
      { type: "FinalTextStable", text: "Hello", inputKind: "contenteditable", nowMs: 1000 },
      cfg
    );
    state = result.state;
    expect(state.kind).toBe("Countdown");

    result = reducer(state, { type: "CountdownFinished", nowMs: 4100 }, cfg);
    state = result.state;
    expect(state.kind).toBe("Sending");

    result = reducer(state, { type: "StopGeneratingOk" }, cfg);
    expect(result.commands.some((command) => command.type === "ClickSendWithAck")).toBe(true);

    result = reducer(state, { type: "SendAckOk" }, cfg);
    expect(result.state.kind).toBe("Done");
  });

  it("cancels on Shift before final text", () => {
    const started = reducer(initialState, submitEvent, cfg).state;
    const result = reducer(started, { type: "ShiftPressed" }, cfg);
    expect(result.state).toEqual({ kind: "Canceled", reason: "shift" });
  });

  it("cancels on Shift during countdown", () => {
    let state = reducer(initialState, submitEvent, cfg).state;
    state = reducer(
      state,
      { type: "FinalTextStable", text: "Hello", inputKind: "contenteditable", nowMs: 1000 },
      cfg
    ).state;
    const result = reducer(state, { type: "ShiftPressed" }, cfg);
    expect(result.state).toEqual({ kind: "Canceled", reason: "shift" });
  });

  it("cancels on Shift before send", () => {
    let state = reducer(initialState, submitEvent, cfg).state;
    state = reducer(
      state,
      { type: "FinalTextStable", text: "Hello", inputKind: "contenteditable", nowMs: 1000 },
      cfg
    ).state;
    state = reducer(state, { type: "CountdownFinished", nowMs: 5000 }, cfg).state;
    const result = reducer(state, { type: "ShiftPressed" }, cfg);
    expect(result.state).toEqual({ kind: "Canceled", reason: "shift" });
  });

  it("does not send when final text is empty", () => {
    const started = reducer(initialState, submitEvent, cfg).state;
    const result = reducer(
      started,
      { type: "FinalTextStable", text: "   ", inputKind: "contenteditable", nowMs: 1000 },
      cfg
    );
    expect(result.state).toEqual({ kind: "Canceled", reason: "empty-final-text" });
  });

  it("respects codex path gating", () => {
    const result = reducer(
      initialState,
      {
        type: "SubmitClicked",
        shiftKey: false,
        isCodexPath: true,
        allowInCodex: false,
        snapshot: ""
      },
      cfg
    );
    expect(result.state).toEqual({ kind: "Canceled", reason: "codex-gated" });
  });
});
