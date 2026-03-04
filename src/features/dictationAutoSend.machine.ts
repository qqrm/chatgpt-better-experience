import { DictationInputKind } from "../domain/dictation";

export type State =
  | { kind: "Idle" }
  | { kind: "AwaitFinalText"; snapshot: string; shiftHeld: boolean }
  | { kind: "Countdown"; startedAtMs: number; durationMs: number; shiftHeld: boolean }
  | { kind: "Sending"; shiftHeld: boolean }
  | { kind: "Done" }
  | { kind: "Canceled"; reason: "shift" | "empty-final-text" | "codex-gated" }
  | { kind: "Failed"; reason: "final-text" | "stop-generating" | "send-timeout" };

export type Event =
  | {
      type: "SubmitClicked";
      shiftKey: boolean;
      isCodexPath: boolean;
      allowInCodex: boolean;
      snapshot: string;
    }
  | { type: "ShiftPressed" }
  | { type: "FinalTextStable"; text: string; inputKind: DictationInputKind; nowMs: number }
  | { type: "FinalTextFailed"; reason: string }
  | { type: "CountdownTick"; nowMs: number }
  | { type: "CountdownFinished"; nowMs: number }
  | { type: "StopGeneratingOk" }
  | { type: "StopGeneratingFailed" }
  | { type: "SendAckOk" }
  | { type: "SendAckTimeout" };

export type Command =
  | { type: "InstallShiftListener" }
  | { type: "RemoveShiftListener" }
  | { type: "WaitForFinalText"; timeoutMs: number; quietMs: number; snapshot: string }
  | { type: "ShowCountdown"; durationMs: number }
  | { type: "UpdateCountdown"; remainingMs: number; totalMs: number }
  | { type: "HideCountdown" }
  | { type: "StopGeneratingIfPossible"; timeoutMs: number }
  | { type: "ClickSendWithAck"; ackTimeoutMs: number }
  | { type: "Log"; scope: string; msg: string; fields?: Record<string, unknown> };

export interface MachineConfig {
  autoSendDelayMs: number;
  finalTextTimeoutMs: number;
  finalTextQuietMs: number;
  sendAckTimeoutMs: number;
}

export const initialState: State = { kind: "Idle" };

export const isTerminalState = (state: State) =>
  state.kind === "Done" || state.kind === "Canceled" || state.kind === "Failed";

export function reducer(
  state: State,
  event: Event,
  config: MachineConfig
): { state: State; commands: Command[] } {
  switch (state.kind) {
    case "Idle": {
      if (event.type !== "SubmitClicked") return { state, commands: [] };
      if (event.isCodexPath && !event.allowInCodex) {
        return {
          state: { kind: "Canceled", reason: "codex-gated" },
          commands: [{ type: "Log", scope: "FLOW", msg: "auto-send skipped on Codex path" }]
        };
      }
      return {
        state: { kind: "AwaitFinalText", snapshot: event.snapshot, shiftHeld: event.shiftKey },
        commands: [
          { type: "InstallShiftListener" },
          {
            type: "WaitForFinalText",
            timeoutMs: config.finalTextTimeoutMs,
            quietMs: config.finalTextQuietMs,
            snapshot: event.snapshot
          }
        ]
      };
    }

    case "AwaitFinalText": {
      if (event.type === "ShiftPressed") {
        return {
          state: { kind: "Canceled", reason: "shift" },
          commands: [{ type: "RemoveShiftListener" }]
        };
      }

      if (event.type === "FinalTextFailed") {
        return {
          state: { kind: "Failed", reason: "final-text" },
          commands: [{ type: "RemoveShiftListener" }]
        };
      }

      if (event.type === "FinalTextStable") {
        if ((event.text || "").trim().length === 0) {
          return {
            state: { kind: "Canceled", reason: "empty-final-text" },
            commands: [{ type: "RemoveShiftListener" }]
          };
        }

        if (state.shiftHeld) {
          return {
            state: { kind: "Canceled", reason: "shift" },
            commands: [{ type: "RemoveShiftListener" }]
          };
        }

        return {
          state: {
            kind: "Countdown",
            startedAtMs: event.nowMs,
            durationMs: config.autoSendDelayMs,
            shiftHeld: false
          },
          commands: [{ type: "ShowCountdown", durationMs: config.autoSendDelayMs }]
        };
      }

      return { state, commands: [] };
    }

    case "Countdown": {
      if (event.type === "ShiftPressed") {
        return {
          state: { kind: "Canceled", reason: "shift" },
          commands: [{ type: "HideCountdown" }, { type: "RemoveShiftListener" }]
        };
      }

      if (event.type === "CountdownTick") {
        const elapsed = event.nowMs - state.startedAtMs;
        const remainingMs = Math.max(0, state.durationMs - elapsed);
        return {
          state,
          commands: [{ type: "UpdateCountdown", remainingMs, totalMs: state.durationMs }]
        };
      }

      if (event.type === "CountdownFinished") {
        if (state.shiftHeld) {
          return {
            state: { kind: "Canceled", reason: "shift" },
            commands: [{ type: "HideCountdown" }, { type: "RemoveShiftListener" }]
          };
        }

        return {
          state: { kind: "Sending", shiftHeld: false },
          commands: [
            { type: "HideCountdown" },
            { type: "StopGeneratingIfPossible", timeoutMs: 20000 }
          ]
        };
      }

      return { state, commands: [] };
    }

    case "Sending": {
      if (event.type === "ShiftPressed") {
        return {
          state: { kind: "Canceled", reason: "shift" },
          commands: [{ type: "RemoveShiftListener" }]
        };
      }

      if (event.type === "StopGeneratingOk") {
        return {
          state,
          commands: [{ type: "ClickSendWithAck", ackTimeoutMs: config.sendAckTimeoutMs }]
        };
      }

      if (event.type === "StopGeneratingFailed") {
        return {
          state: { kind: "Failed", reason: "stop-generating" },
          commands: [{ type: "RemoveShiftListener" }]
        };
      }

      if (event.type === "SendAckOk") {
        return {
          state: { kind: "Done" },
          commands: [{ type: "RemoveShiftListener" }]
        };
      }

      if (event.type === "SendAckTimeout") {
        return {
          state: { kind: "Failed", reason: "send-timeout" },
          commands: [{ type: "RemoveShiftListener" }]
        };
      }

      return { state, commands: [] };
    }

    default:
      return { state, commands: [] };
  }
}
