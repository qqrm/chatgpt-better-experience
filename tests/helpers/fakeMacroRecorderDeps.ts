import type { eventWithTime } from "@rrweb/types";
import type { MacroRecorderDeps, RrwebStartOptions } from "../../src/features/macroRecorder.deps";

export function makeFakeMacroRecorderDeps() {
  let nowValue = 1_700_000_000_000;
  let rrwebStopCalls = 0;

  const rrwebStarts: RrwebStartOptions[] = [];
  const rrwebCustomEvents: Array<{ tag: string; payload: unknown }> = [];
  const downloads: Array<{ filename: string; payload: unknown }> = [];
  const toasts: Array<{ message: string; tone: "active" | "neutral" }> = [];

  const deps: MacroRecorderDeps = {
    now: () => ++nowValue,
    isoNow: () => "2026-02-24T18:42:22.883Z",
    pageUrl: () => "https://chatgpt.com/",
    userAgent: () => "Mozilla/5.0 test",
    startRrweb: (options) => {
      rrwebStarts.push(options);
      return () => {
        rrwebStopCalls += 1;
      };
    },
    addRrwebCustomEvent: (tag, payload) => {
      rrwebCustomEvents.push({ tag, payload });
    },
    downloadJson: (filename, payload) => {
      downloads.push({ filename, payload });
    },
    showToast: (message, tone = "neutral") => {
      toasts.push({ message, tone });
    }
  };

  const emitRrweb = (event: eventWithTime) => {
    const current = rrwebStarts[rrwebStarts.length - 1];
    if (!current) throw new Error("rrweb not started");
    current.emit(event);
  };

  return {
    deps,
    downloads,
    toasts,
    rrwebStarts,
    rrwebCustomEvents,
    emitRrweb,
    get rrwebStopCalls() {
      return rrwebStopCalls;
    }
  };
}
