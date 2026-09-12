import { afterEach, describe, expect, it, vi } from "vitest";
import { bindContentScriptLifecycle } from "../src/application/contentScript";

describe("content script lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("disposes every feature and removes listeners exactly once on unload", () => {
    const disposeFirst = vi.fn();
    const disposeSecond = vi.fn();
    const domBus = { dispose: vi.fn() };
    const unsubscribeStorage = vi.fn();
    const onVisibilityChange = vi.fn();
    const removeVisibility = vi.spyOn(document, "removeEventListener");

    bindContentScriptLifecycle({
      domBus,
      features: [
        { name: "first", dispose: disposeFirst },
        { name: "second", dispose: disposeSecond }
      ],
      unsubscribeStorage,
      onVisibilityChange
    });

    window.dispatchEvent(new Event("unload"));
    window.dispatchEvent(new Event("unload"));

    expect(disposeFirst).toHaveBeenCalledOnce();
    expect(disposeSecond).toHaveBeenCalledOnce();
    expect(domBus.dispose).toHaveBeenCalledOnce();
    expect(unsubscribeStorage).toHaveBeenCalledOnce();
    expect(removeVisibility).toHaveBeenCalledWith("visibilitychange", onVisibilityChange);
  });
});
