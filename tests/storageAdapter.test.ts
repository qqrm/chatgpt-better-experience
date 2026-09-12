import { describe, expect, it, vi } from "vitest";
import { createStoragePort } from "../src/infra/storageAdapter";

describe("storage adapter subscriptions", () => {
  it("returns an unsubscribe function that removes the exact listener", () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();
    const port = createStoragePort({
      storageApi: {
        onChanged: { addListener, removeListener }
      }
    });
    const handler = vi.fn();

    const unsubscribe = port.onChanged?.(handler);
    expect(addListener).toHaveBeenCalledWith(handler);
    expect(unsubscribe).toBeTypeOf("function");

    if (typeof unsubscribe === "function") unsubscribe();
    expect(removeListener).toHaveBeenCalledWith(handler);
  });
});
