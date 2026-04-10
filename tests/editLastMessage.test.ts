import { afterEach, describe, expect, it } from "vitest";
import { initEditLastMessageFeature } from "../src/features/editLastMessage";
import { makeTestContext } from "./helpers/testContext";

const buildEditDom = (extra = "") => {
  document.body.innerHTML = `
    <main role="main">
      <article>
        <div data-message-author-role="user" id="last-user-message">Hello</div>
        <button id="edit-message-button" aria-label="Edit message">Edit</button>
        <textarea id="edit-input"></textarea>
      </article>
      <footer>
        <form data-testid="composer">
          <div id="prompt-textarea" contenteditable="true" role="textbox" aria-multiline="true"></div>
          ${extra}
        </form>
      </footer>
    </main>
  `;
};

const dispatchArrowUp = async (target: HTMLElement) => {
  target.focus();
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  await Promise.resolve();
  await Promise.resolve();
};

describe("editLastMessage", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("ArrowUp starts edit mode when composer is empty and no blockers are present", async () => {
    buildEditDom();

    const calls: string[] = [];
    const ctx = makeTestContext({ editLastMessageOnArrowUp: true });
    ctx.helpers.humanClick = (_el, why) => {
      calls.push(why);
      return true;
    };

    const handle = initEditLastMessageFeature(ctx);
    const composer = document.getElementById("prompt-textarea") as HTMLElement;

    await dispatchArrowUp(composer);

    expect(calls).toContain("edit last message");
    expect(document.activeElement?.id).toBe("edit-input");

    handle.dispose();
  });

  it("ArrowUp does not start edit mode while assistant generation can still be stopped", async () => {
    buildEditDom(`
      <button id="stop-generating" aria-label="Stop generating">Stop</button>
    `);

    const calls: string[] = [];
    const ctx = makeTestContext({ editLastMessageOnArrowUp: true });
    ctx.helpers.humanClick = (_el, why) => {
      calls.push(why);
      return true;
    };

    const handle = initEditLastMessageFeature(ctx);
    const composer = document.getElementById("prompt-textarea") as HTMLElement;

    await dispatchArrowUp(composer);

    expect(calls).not.toContain("edit last message");

    handle.dispose();
  });

  it("ArrowUp does not start edit mode while auto-send countdown is armed", async () => {
    buildEditDom(`
      <div id="tm-autosend-countdown"></div>
    `);

    const calls: string[] = [];
    const ctx = makeTestContext({ editLastMessageOnArrowUp: true });
    ctx.helpers.humanClick = (_el, why) => {
      calls.push(why);
      return true;
    };

    const handle = initEditLastMessageFeature(ctx);
    const composer = document.getElementById("prompt-textarea") as HTMLElement;

    await dispatchArrowUp(composer);

    expect(calls).not.toContain("edit last message");

    handle.dispose();
  });

  it("ArrowUp still starts edit mode when an empty contenteditable contains placeholder DOM", async () => {
    document.body.innerHTML = `
      <main role="main">
        <article id="turn">
          <div data-message-author-role="user" id="last-user-message">Hello</div>
          <button id="edit-message-button" aria-label="Edit message">Edit</button>
          <textarea id="edit-input"></textarea>
        </article>
        <footer>
          <form data-testid="composer">
            <div id="prompt-textarea" contenteditable="true" role="textbox" aria-multiline="true">
              <p data-placeholder="Ask anything" class="placeholder">Ask anything</p>
            </div>
          </form>
        </footer>
      </main>
    `;

    const calls: string[] = [];
    const ctx = makeTestContext({ editLastMessageOnArrowUp: true });
    ctx.helpers.humanClick = (_el, why) => {
      calls.push(why);
      return true;
    };

    const handle = initEditLastMessageFeature(ctx);
    const composer = document.getElementById("prompt-textarea") as HTMLElement;

    await dispatchArrowUp(composer);

    expect(calls).toContain("edit last message");
    expect(document.activeElement?.id).toBe("edit-input");

    handle.dispose();
  });
});
