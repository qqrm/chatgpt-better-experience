import { describe, expect, it } from "vitest";
import exportFixture from "./fixtures/macroRecorder-export-sample.json";

type FixtureAction = {
  t: number;
  kind: string;
  selector?: string;
};

type MacroRecorderExportFixture = {
  schemaVersion: number;
  segments: Array<{
    index: number;
    rrwebEvents: Array<{ timestamp?: number }>;
    actions: FixtureAction[];
    lifecycleTrace: Array<{ event: string }>;
  }>;
  meta: {
    segmentCount: number;
    startedAt: number;
    stoppedAt: number | null;
  };
};

describe("macro recorder export contract fixture", () => {
  it("matches schema v2 invariants", () => {
    const fixture = exportFixture as MacroRecorderExportFixture;

    expect(fixture.schemaVersion).toBe(2);
    expect(Array.isArray(fixture.segments)).toBe(true);
    expect(fixture.meta.segmentCount).toBe(fixture.segments.length);
    expect(fixture.meta.startedAt).toBeGreaterThan(0);

    for (const segment of fixture.segments) {
      expect(segment.index).toBeGreaterThan(0);
      expect(Array.isArray(segment.rrwebEvents)).toBe(true);
      expect(Array.isArray(segment.actions)).toBe(true);
      expect(Array.isArray(segment.lifecycleTrace)).toBe(true);

      for (const action of segment.actions) {
        expect(["click", "input", "keydown"]).toContain(action.kind);
        if (action.kind === "click" || action.kind === "input") {
          expect(typeof action.selector).toBe("string");
          expect(action.selector?.length).toBeGreaterThan(0);
        }
      }

      const rrwebTimestamps = segment.rrwebEvents
        .map((event) => event.timestamp)
        .filter((timestamp): timestamp is number => typeof timestamp === "number");
      for (let i = 1; i < rrwebTimestamps.length; i += 1) {
        expect(rrwebTimestamps[i]!).toBeGreaterThanOrEqual(rrwebTimestamps[i - 1]!);
      }
    }
  });
});
