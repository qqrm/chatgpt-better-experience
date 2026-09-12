import { afterEach, describe, expect, it, vi } from "vitest";
import { createDomEventBus } from "../src/application/domEventBus";
import { initMessageTimestampsFeature } from "../src/features/messageTimestamps";
import { makeTestContext } from "./helpers/testContext";

const flush = async () => {
  await new Promise((resolve) => window.setTimeout(resolve, 32));
  await new Promise((resolve) => window.setTimeout(resolve, 32));
};

describe("message timestamps with DomEventBus", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    window.history.replaceState({}, "", "/");
  });

  it("timestamps a user message appended after a captured composer submit", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(((
      callback: FrameRequestCallback
    ) => window.setTimeout(() => callback(performance.now()), 0)) as typeof requestAnimationFrame);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(((id: number) =>
      window.clearTimeout(id)) as typeof cancelAnimationFrame);
    window.history.replaceState({}, "", "/c/synthetic-timestamps");
    document.body.innerHTML = `
      <main>
        <div id="thread"></div>
        <form data-testid="composer"><textarea data-testid="prompt-textarea"></textarea><button type="submit">Send</button></form>
      </main>
    `;
    const ctx = makeTestContext({ showMessageTimestamps: true });
    const domBus = createDomEventBus(ctx);
    ctx.domBus = domBus;
    const handle = initMessageTimestampsFeature(ctx);
    await flush();

    const form = document.querySelector("form");
    const thread = document.getElementById("thread");
    if (!form || !thread) throw new Error("Missing test DOM");
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    const message = document.createElement("div");
    message.setAttribute("data-message-id", "synthetic-user-1");
    message.setAttribute("data-message-author-role", "user");
    const bubble = document.createElement("div");
    bubble.className = "user-message-bubble-color";
    message.append(bubble);
    thread.append(message);
    await flush();

    // Diagnostic assertion: the real bus must have emitted the mutation before the feature can render.
    expect(domBus.getStats().emits.main).toBeGreaterThan(1);
    expect(bubble.querySelector("[data-qqrm-message-time]")?.textContent).toMatch(/\d/);
    handle.dispose();
    domBus.dispose();
  });
});
