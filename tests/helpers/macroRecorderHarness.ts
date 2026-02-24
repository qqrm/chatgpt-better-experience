import { initMacroRecorderFeature } from "../../src/features/macroRecorder";
import { makeFakeMacroRecorderDeps } from "./fakeMacroRecorderDeps";
import { makeTestContext } from "./testContext";

export function makeMacroRecorderHarness(enabled = true) {
  const storageWrites: Record<string, unknown>[] = [];
  const ctx = makeTestContext({ macroRecorderEnabled: enabled });
  ctx.storagePort.set = async (values) => {
    storageWrites.push(values);
  };

  const fx = makeFakeMacroRecorderDeps();
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

  return {
    ctx,
    handle,
    fx,
    storageWrites,
    pressToggle,
    dispose: () => handle.dispose()
  };
}
