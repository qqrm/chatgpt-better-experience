import { beforeEach, describe, expect, it } from "vitest";
import { makeMacroRecorderHarness } from "./helpers/macroRecorderHarness";
import { makeFakeMacroRecorderDeps } from "./helpers/fakeMacroRecorderDeps";
import {
  createMacroRecorderPersistence,
  type MacroRecorderSegment,
  type MacroRecorderStorageAdapter
} from "../src/features/macroRecorder.persistence";

describe("macroRecorder feature", () => {
  beforeEach(() => {
    document.body.innerHTML = "<button id='x'>Click</button>";
  });

  it("does nothing on Ctrl+Shift+F8 while disabled", async () => {
    const h = makeMacroRecorderHarness(false);

    const event = h.pressToggle();
    await h.flushAsync();

    expect(event.defaultPrevented).toBe(false);
    expect(h.fx.rrwebStarts).toHaveLength(0);
    expect(h.storageWrites).toHaveLength(0);

    h.dispose();
  });

  it("handles toggle while typing in editable targets", async () => {
    const h = makeMacroRecorderHarness(true);
    const input = document.createElement("input");
    document.body.appendChild(input);

    const event = h.pressToggle(input);
    await h.flushAsync();

    expect(event.defaultPrevented).toBe(true);
    expect(h.fx.rrwebStarts).toHaveLength(1);
    expect(h.storageWrites.some((w) => w.macroRecorderStatus === "recording")).toBe(true);
    expect(h.fx.toasts[h.fx.toasts.length - 1]?.message).toBe("Macro recording started");

    h.dispose();
  });

  it("starts recording on first Ctrl+Shift+F8 press", async () => {
    const h = makeMacroRecorderHarness(true);

    const event = h.pressToggle();
    await h.flushAsync();

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

  it("stops and exports on second Ctrl+Shift+F8 press", async () => {
    const h = makeMacroRecorderHarness(true);

    const startEvent = h.pressToggle();
    await h.flushAsync();
    const stopEvent = h.pressToggle();
    await h.flushAsync();

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
      segments: unknown[];
    };
    expect(payload.schemaVersion).toBe(2);
    expect(Array.isArray(payload.segments)).toBe(true);

    h.dispose();
  });

  it("is idempotent for repeated stop-intent presses", async () => {
    const h = makeMacroRecorderHarness(true);

    h.pressToggle();
    await h.flushAsync();
    h.pressToggle();
    await h.flushAsync();
    h.pressToggle(undefined, { repeat: true });
    await h.flushAsync();

    expect(h.fx.rrwebStarts).toHaveLength(1);
    expect(h.fx.rrwebStopCalls).toBe(1);
    expect(h.fx.downloads).toHaveLength(1);

    h.dispose();
  });

  it("exports contract-compatible payload", async () => {
    const h = makeMacroRecorderHarness(true);

    h.pressToggle();
    await h.flushAsync();
    h.fx.emitRrweb({ type: 0, timestamp: 1700000000500, data: {} as never });

    const input = document.createElement("input");
    input.id = "prompt-input";
    input.value = "hello";
    document.body.appendChild(input);
    input.dispatchEvent(new Event("input", { bubbles: true }));

    h.pressToggle();
    await h.flushAsync();

    const exported = h.fx.downloads[0]?.payload as {
      schemaVersion: number;
      segments: Array<{
        rrwebEvents: Array<{ timestamp?: number }>;
        actions: Array<{ t: number; kind: string; selector?: string }>;
      }>;
      meta: { segmentCount: number };
    };

    expect(exported.schemaVersion).toBe(2);
    expect(exported.meta.segmentCount).toBe(1);
    expect(Array.isArray(exported.segments[0]?.rrwebEvents)).toBe(true);
    expect(Array.isArray(exported.segments[0]?.actions)).toBe(true);

    h.dispose();
  });

  it("resumes across reloads and exports multi-segment session", async () => {
    const fx = makeFakeMacroRecorderDeps();
    const h1 = makeMacroRecorderHarness(true, fx);

    await ensureRecordingStarted(h1);
    h1.fx.emitRrweb({ type: 0, timestamp: 1, data: {} as never });
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
    h1.dispose();
    await h1.flushAsync();

    const h2 = makeMacroRecorderHarness(true, fx);
    await h2.waitFor(() => h2.fx.rrwebStarts.length > 1);

    expect(h2.fx.toasts.some((toast) => toast.message.includes("resumed (segment 2)"))).toBe(true);

    h2.fx.emitRrweb({ type: 0, timestamp: 2, data: {} as never });
    h2.pressToggle();
    await h2.waitFor(() => h2.fx.downloads.length === 1);
    expect(h2.fx.downloads.length).toBe(1);

    const exported = h2.fx.downloads[0]?.payload as {
      segments: Array<{ index: number; rrwebEvents: Array<{ timestamp: number }> }>;
      meta: { segmentCount: number };
    };

    expect(exported.meta.segmentCount).toBe(2);
    expect(exported.segments[0]?.index).toBe(1);
    expect(exported.segments[1]?.index).toBe(2);
    expect(exported.segments[0]?.rrwebEvents.some((e) => e.timestamp === 1)).toBe(true);
    expect(exported.segments[1]?.rrwebEvents.some((e) => e.timestamp === 2)).toBe(true);

    h2.dispose();
  });

  it("records segment finalization marker on stop", async () => {
    const h = makeMacroRecorderHarness(true);

    await ensureRecordingStarted(h);
    h.pressToggle();
    await h.waitFor(() => h.fx.downloads.length === 1);

    const exported = h.fx.downloads[0]?.payload as {
      segments: Array<{ endedAt: number | null; lifecycleTrace: Array<{ event: string }> }>;
    };

    expect(exported.segments[0]?.endedAt).not.toBeNull();
    expect(
      exported.segments[0]?.lifecycleTrace.some((entry) => entry.event === "segment_finalize")
    ).toBe(true);

    h.dispose();
  });

  it("finalizes active segment during dispose/reload teardown", async () => {
    const fx = makeFakeMacroRecorderDeps();
    const h = makeMacroRecorderHarness(true, fx);

    await ensureRecordingStarted(h);
    h.dispose();
    await h.flushAsync();

    const segments = readSegmentsFromStore(fx.persistentStore);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.endedAt).not.toBeNull();
    expect(segments[0]?.lifecycleTrace.some((entry) => entry.event === "segment_finalize")).toBe(
      true
    );
  });

  it("prevents overlap write clobbering across segment keys", async () => {
    const store = new Map<string, unknown>();
    const adapter: MacroRecorderStorageAdapter = {
      get: async (key) => store.get(key) ?? null,
      set: async (key, value) => {
        store.set(key, value);
      },
      remove: async (key) => {
        store.delete(key);
      }
    };

    const oldInstance = createMacroRecorderPersistence(adapter);
    const newInstance = createMacroRecorderPersistence(adapter);

    await oldInstance.createSession({
      sessionId: "session-1",
      createdAt: 100,
      createdAtIso: "2026-02-24T18:42:22.883Z",
      userAgent: "test-agent"
    });

    await oldInstance.createSegment({
      sessionId: "session-1",
      segmentId: "seg-1",
      index: 1,
      startedAt: 101,
      startedAtIso: "2026-02-24T18:42:22.883Z",
      pageUrl: "https://chatgpt.com/",
      referrer: "",
      navigationType: "reload"
    });

    await oldInstance.appendToSegment({
      sessionId: "session-1",
      segmentId: "seg-1",
      lifecycleTrace: [makeLifecycleTrace("segment_start")]
    });

    await newInstance.createSegment({
      sessionId: "session-1",
      segmentId: "seg-2",
      index: 2,
      startedAt: 200,
      startedAtIso: "2026-02-24T18:42:22.883Z",
      pageUrl: "https://chatgpt.com/",
      referrer: "",
      navigationType: "reload"
    });

    await oldInstance.appendToSegment({
      sessionId: "session-1",
      segmentId: "seg-1",
      lifecycleTrace: [makeLifecycleTrace("segment_finalize")]
    });

    await newInstance.appendToSegment({
      sessionId: "session-1",
      segmentId: "seg-2",
      lifecycleTrace: [makeLifecycleTrace("segment_start")]
    });

    const exported = await newInstance.buildExport("session-1");

    expect(exported?.segments).toHaveLength(2);
    expect(exported?.segments[0]?.segmentId).toBe("seg-1");
    expect(exported?.segments[1]?.segmentId).toBe("seg-2");
    expect(
      exported?.segments[0]?.lifecycleTrace.some((entry) => entry.event === "segment_finalize")
    ).toBe(true);
    expect(
      exported?.segments[1]?.lifecycleTrace.some((entry) => entry.event === "segment_start")
    ).toBe(true);
  });

  it("captures lifecycle trace entries", async () => {
    const h = makeMacroRecorderHarness(true);

    await ensureRecordingStarted(h);

    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));

    for (let i = 0; i < 3 && h.fx.downloads.length === 0; i += 1) {
      h.pressToggle();
      await h.waitFor(() => h.fx.downloads.length === 1, 600);
    }
    expect(h.fx.downloads.length).toBe(1);

    const exported = h.fx.downloads[0]?.payload as {
      segments: Array<{ lifecycleTrace: Array<{ event: string }> }>;
    };
    const events = exported.segments[0]?.lifecycleTrace.map((entry) => entry.event) ?? [];

    expect(events).toContain("pageshow");
    expect(events).toContain("pagehide");
    expect(events).toContain("visibilitychange");

    h.dispose();
  });

  it("clears persisted state after stop/export", async () => {
    const fx = makeFakeMacroRecorderDeps();
    const h1 = makeMacroRecorderHarness(true, fx);

    h1.pressToggle();
    await h1.flushAsync();
    h1.pressToggle();
    await h1.flushAsync();
    h1.dispose();

    const h2 = makeMacroRecorderHarness(true, fx);
    await h2.flushAsync();

    expect(h2.fx.toasts.some((toast) => toast.message.includes("resumed"))).toBe(false);

    h2.dispose();
  });
});
const readSegmentsFromStore = (store: Map<string, unknown>): MacroRecorderSegment[] =>
  Array.from(store.entries())
    .filter(([key]) => key.startsWith("macroRecorderDebugSessionSegment:"))
    .map(([, value]) => value as MacroRecorderSegment)
    .sort((a, b) => a.index - b.index);

const makeLifecycleTrace = (event: "segment_start" | "segment_finalize") => ({
  t: 1,
  isoTime: "2026-02-24T18:42:22.883Z",
  event,
  url: "https://chatgpt.com/",
  navType: "reload" as const,
  visibilityState: "visible" as const,
  readyState: "complete" as const,
  referrer: ""
});

const ensureRecordingStarted = async (h: ReturnType<typeof makeMacroRecorderHarness>) => {
  for (let i = 0; i < 3 && h.fx.rrwebStarts.length === 0; i += 1) {
    h.pressToggle();
    await h.waitFor(() => h.fx.rrwebStarts.length > 0, 600);
  }
  expect(h.fx.rrwebStarts.length).toBeGreaterThan(0);
};
