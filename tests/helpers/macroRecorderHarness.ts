import { initMacroRecorderFeature } from "../../src/features/macroRecorder";
import { makeFakeMacroRecorderDeps } from "./fakeMacroRecorderDeps";
import { makeTestContext } from "./testContext";

export function makeMacroRecorderHarness(enabled = true, existing = makeFakeMacroRecorderDeps()) {
  const storageWrites: Record<string, unknown>[] = [];
  const ctx = makeTestContext({ macroRecorderEnabled: enabled });
  ctx.storagePort.set = async (values) => {
    storageWrites.push(values);
  };

  const fx = existing;
  const handle = initMacroRecorderFeature(ctx, fx.deps);

  const pressToggle = (target?: EventTarget, extra: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", {
      key: "F8",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
      ...extra
    });

    (target ?? window).dispatchEvent(event);
    return event;
  };

  const flushAsync = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  const waitFor = async (predicate: () => boolean, timeoutMs = 2000) => {
    const started = Date.now();
    while (!predicate()) {
      if (Date.now() - started > timeoutMs) break;
      await flushAsync();
    }
  };

  return {
    ctx,
    handle,
    fx,
    storageWrites,
    pressToggle,
    flushAsync,
    waitFor,
    dispose: () => handle.dispose()
  };
}
