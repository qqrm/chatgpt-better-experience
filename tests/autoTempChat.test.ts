import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initAutoTempChatFeature } from "../src/features/autoTempChat";
import { makeTestContext } from "./helpers/testContext";

describe("autoTempChat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("enables the temporary-chat control once it is available", async () => {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.id = "temporary-chat-checkbox";
    checkbox.type = "checkbox";
    label.append(checkbox);
    document.body.append(label);

    const ctx = makeTestContext({ autoTempChat: true });
    ctx.helpers.humanClick = (target) => {
      target?.click();
      return target !== null;
    };

    const handle = initAutoTempChatFeature(ctx);
    await vi.advanceTimersByTimeAsync(250);

    expect(checkbox.checked).toBe(true);
    handle.dispose();
  });

  it("does not alter the control while disabled", async () => {
    const checkbox = document.createElement("input");
    checkbox.id = "temporary-chat-checkbox";
    checkbox.type = "checkbox";
    document.body.append(checkbox);

    const handle = initAutoTempChatFeature(makeTestContext({ autoTempChat: false }));
    await vi.advanceTimersByTimeAsync(500);

    expect(checkbox.checked).toBe(false);
    handle.dispose();
  });
});
