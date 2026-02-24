import { describe, expect, it } from "vitest";
import exportFixture from "./fixtures/macroRecorder-export-sample.json";

type FixtureAction = {
  t: number;
  kind: string;
  selector?: string;
};

type MacroRecorderExportFixture = {
  schemaVersion: number;
  rrwebEvents: Array<{ timestamp?: number }>;
  actions: FixtureAction[];
  meta: {
    durationMs: number;
    startedAt: number | null;
    stoppedAt: number | null;
  };
};

describe("macro recorder export contract fixture", () => {
  it("matches schema v1 invariants", () => {
    const fixture = exportFixture as MacroRecorderExportFixture;

    expect(fixture.schemaVersion).toBe(1);
    expect(Array.isArray(fixture.rrwebEvents)).toBe(true);
    expect(Array.isArray(fixture.actions)).toBe(true);
    expect(fixture.meta.durationMs).toBeGreaterThanOrEqual(0);

    for (const action of fixture.actions) {
      expect(["click", "input", "keydown"]).toContain(action.kind);
      if (action.kind === "click" || action.kind === "input") {
        expect(typeof action.selector).toBe("string");
        expect(action.selector?.length).toBeGreaterThan(0);
      }
    }

    for (let i = 1; i < fixture.actions.length; i += 1) {
      expect(fixture.actions[i]!.t).toBeGreaterThanOrEqual(fixture.actions[i - 1]!.t);
    }

    const rrwebTimestamps = fixture.rrwebEvents
      .map((event) => event.timestamp)
      .filter((timestamp): timestamp is number => typeof timestamp === "number");
    for (let i = 1; i < rrwebTimestamps.length; i += 1) {
      expect(rrwebTimestamps[i]!).toBeGreaterThanOrEqual(rrwebTimestamps[i - 1]!);
    }
  });
});
