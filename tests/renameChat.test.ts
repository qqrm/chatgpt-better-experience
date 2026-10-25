import { afterEach, describe, expect, it } from "vitest";
import { initEditLastMessageFeature } from "../src/features/editLastMessage";
import { makeTestContext } from "./helpers/testContext";

describe("F2 rename chat", () => {
  let dispose: (() => void) | undefined;
  afterEach(() => {
    dispose?.();
    document.body.innerHTML = "";
    history.replaceState(null, "", "/");
  });

  const setup = (enabled = true) => {
    history.replaceState(null, "", "/c/current");
    document.body.innerHTML = `
      <nav aria-label="Chat history">
        <a data-sidebar-item="true" href="/c/current-other"><button data-testid="wrong-options">Options</button></a>
        <a data-sidebar-item="true" href="/c/current?view=chat"><button data-testid="correct-options">Options</button><input value="Current chat"></a>
      </nav>
      <div data-radix-menu-content role="menu"><div role="menuitem" data-testid="rename-chat-menu-item">Rename</div></div>
    `;
    const clicks: string[] = [];
    const ctx = makeTestContext({ renameChatOnF2: enabled });
    ctx.helpers.humanClick = (el) => {
      clicks.push(el?.getAttribute("data-testid") ?? "");
      return true;
    };
    dispose = initEditLastMessageFeature(ctx).dispose;
    return clicks;
  };

  const pressF2 = async (repeat = false) => {
    const event = new KeyboardEvent("keydown", {
      key: "F2",
      bubbles: true,
      cancelable: true,
      repeat
    });
    window.dispatchEvent(event);
    await Promise.resolve();
    await Promise.resolve();
    return event;
  };

  it("opens the exact current conversation and selects its rename input", async () => {
    const clicks = setup();
    await pressF2();
    expect(clicks).toEqual(["correct-options", "rename-chat-menu-item"]);
    const input = document.querySelector("input")!;
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it("does nothing when disabled", async () => {
    const clicks = setup(false);
    const event = await pressF2();
    expect(clicks).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores repeated keydown", async () => {
    const clicks = setup();
    await pressF2(true);
    expect(clicks).toEqual([]);
  });
});
