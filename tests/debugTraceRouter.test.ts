import { afterEach, describe, expect, it, vi } from "vitest";
import { createFeatureContext } from "../src/application/featureContext";
import { SETTINGS_DEFAULTS, Settings } from "../src/domain/settings";

const storagePort = {
  get: async <T extends Record<string, unknown>>(defaults: T): Promise<T> => defaults,
  set: async () => {}
};

const makeCtx = (patch: Partial<Settings>) =>
  createFeatureContext({
    settings: { ...SETTINGS_DEFAULTS, ...patch },
    storagePort,
    debugEnabled: false
  });

describe("debug trace router", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("debug disabled: emits nothing", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const ctx = makeCtx({ debugAutoExpandProjects: false, debugTraceTarget: "autoSend" });

    ctx.logger.trace("autoSend", "FLOW", "submit click flow start", {
      path: "/c/disabled"
    });

    expect(logSpy).not.toHaveBeenCalled();
  });

  it("debug enabled + matching target: emits in stable format", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const ctx = makeCtx({ debugAutoExpandProjects: true, debugTraceTarget: "autoSend" });

    ctx.logger.trace("autoSend", "FLOW", "submit click flow start", {
      mode: "chat",
      path: "/c/abc"
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = String(logSpy.mock.calls[0][0]);
    expect(line).toMatch(
      /^\[TM Trace\]\[autoSend\] #1 \+\s*\d+ms FLOW: submit click flow start \| .+/
    );
    expect(line).toContain("mode=chat");
    expect(line).toContain("path=/c/abc");
  });

  it("routes by target: only selected target logs", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const ctx = makeCtx({ debugAutoExpandProjects: true, debugTraceTarget: "projects" });

    ctx.logger.trace("autoSend", "FLOW", "should be suppressed");
    ctx.logger.trace("projects", "FLOW", "should be logged");

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = String(logSpy.mock.calls[0][0]);
    expect(line).toContain("[TM Trace][projects]");
    expect(line).toContain("should be logged");
  });

  it("contract snapshot emits expected invariant fields", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const ctx = makeCtx({ debugAutoExpandProjects: true, debugTraceTarget: "editMessage" });

    ctx.logger.contractSnapshot("editMessage", "KEY", {
      path: "/c/42",
      mode: "chat",
      dictationState: "SUBMIT",
      composerKind: "contenteditable",
      sendButtonState: "ready"
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = String(logSpy.mock.calls[0][0]);
    expect(line).toContain("[TM Trace][editMessage]");
    expect(line).toContain("contract snapshot");
    expect(line).toContain("path=/c/42");
    expect(line).toContain("mode=chat");
    expect(line).toContain("dictationState=SUBMIT");
    expect(line).toContain("composerKind=contenteditable");
    expect(line).toContain("sendButtonState=ready");
  });
});
