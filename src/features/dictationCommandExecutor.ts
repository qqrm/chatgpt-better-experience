import type {
  Command as AutoSendCommand,
  Event as AutoSendEvent
} from "./dictationAutoSend.machine";
import type { InputReadResult } from "./dictationComposerDom";
import type { LogFields } from "../application/featureContext";

interface CommandPorts {
  signal: AbortSignal;
  now: () => number;
  shiftHandler: (event: KeyboardEvent) => void;
  waitForFinalText: (args: {
    snapshot: string;
    timeoutMs: number;
    quietMs: number;
    shouldAbort?: () => boolean;
  }) => Promise<InputReadResult>;
  runCountdownEffect: (durationMs: number) => Promise<void>;
  updateCountdown: (remainingMs: number, totalMs: number) => void;
  hideCountdown: () => void;
  stopGeneratingIfPossible: (timeoutMs: number, shouldAbort: () => boolean) => Promise<boolean>;
  clickSendWithAck: (timeoutMs: number, shouldAbort: () => boolean) => Promise<boolean>;
  tmLog: (scope: string, msg: string, fields?: LogFields) => void;
  enqueue: (commands: AutoSendCommand[]) => void;
  step: (event: AutoSendEvent) => AutoSendCommand[];
}

export function createCommandExecutor({
  signal,
  now,
  shiftHandler,
  waitForFinalText,
  runCountdownEffect,
  updateCountdown,
  hideCountdown,
  stopGeneratingIfPossible,
  clickSendWithAck,
  tmLog,
  enqueue,
  step
}: CommandPorts) {
  let shiftListenerInstalled = false;
  const executeCommand = async (command: AutoSendCommand) => {
    if (signal.aborted) return;
    switch (command.type) {
      case "InstallShiftListener": {
        if (!shiftListenerInstalled) {
          window.addEventListener("keydown", shiftHandler, true);
          shiftListenerInstalled = true;
        }
        return;
      }
      case "RemoveShiftListener": {
        if (shiftListenerInstalled) {
          window.removeEventListener("keydown", shiftHandler, true);
          shiftListenerInstalled = false;
        }
        return;
      }
      case "WaitForFinalText": {
        const finalRes = await waitForFinalText({
          snapshot: command.snapshot,
          timeoutMs: command.timeoutMs,
          quietMs: command.quietMs,
          shouldAbort: () => signal.aborted
        });
        if (signal.aborted) return;

        if (!finalRes.ok) {
          enqueue(step({ type: "FinalTextFailed", reason: "timeout" }));
          return;
        }

        enqueue(
          step({
            type: "FinalTextStable",
            text: finalRes.text,
            inputKind: finalRes.kind,
            nowMs: now()
          })
        );
        return;
      }
      case "ShowCountdown": {
        await runCountdownEffect(command.durationMs);
        return;
      }
      case "UpdateCountdown": {
        updateCountdown(command.remainingMs, command.totalMs);
        return;
      }
      case "HideCountdown": {
        hideCountdown();
        return;
      }
      case "StopGeneratingIfPossible": {
        const ok = await stopGeneratingIfPossible(command.timeoutMs, () => signal.aborted);
        if (signal.aborted) return;
        enqueue(step({ type: ok ? "StopGeneratingOk" : "StopGeneratingFailed" }));
        return;
      }
      case "ClickSendWithAck": {
        const ok = await clickSendWithAck(command.ackTimeoutMs, () => signal.aborted);
        if (signal.aborted) return;
        enqueue(step({ type: ok ? "SendAckOk" : "SendAckTimeout" }));
        return;
      }
      case "Log": {
        tmLog(command.scope, command.msg, command.fields);
        return;
      }
    }
  };

  return {
    executeCommand,
    dispose() {
      if (shiftListenerInstalled) {
        window.removeEventListener("keydown", shiftHandler, true);
        shiftListenerInstalled = false;
      }
    }
  };
}
