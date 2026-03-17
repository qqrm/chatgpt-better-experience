import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestContext } from "./helpers/testContext";

function mountConversation() {
  window.history.replaceState({}, "", "/c/test-conversation");
  document.body.innerHTML = `
    <main role="main">
      <div data-scroll-root>
        <article data-message-id="user-1" data-message-author-role="user">
          <div>Hello</div>
        </article>
        <article data-message-id="assistant-1" data-message-author-role="assistant">
          <div>Hi</div>
        </article>
      </div>
      <form data-testid="composer">
        <textarea data-testid="prompt-textarea"></textarea>
        <button type="submit">Send</button>
      </form>
    </main>
  `;

  const scrollRoot = document.querySelector<HTMLElement>("[data-scroll-root]");
  const form = document.querySelector<HTMLFormElement>("form[data-testid='composer']");
  if (!scrollRoot || !form) throw new Error("Missing test DOM");

  let scrollTop = 0;
  Object.defineProperty(scrollRoot, "clientHeight", {
    configurable: true,
    get: () => 400
  });
  Object.defineProperty(scrollRoot, "scrollHeight", {
    configurable: true,
    get: () => 2000
  });
  Object.defineProperty(scrollRoot, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: unknown) => {
      scrollTop = Number(value) || 0;
    }
  });

  scrollRoot.scrollTop = 1000;
  return { scrollRoot, form };
}

describe("preserveReadingPositionOnSend", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", ((cb: FrameRequestCallback) =>
      window.setTimeout(() => cb(performance.now()), 16)) as typeof requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", ((id: number) =>
      window.clearTimeout(id)) as typeof cancelAnimationFrame);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    window.history.replaceState({}, "", "/");
  });

  it("releases the lock during a long pointer-driven downward scroll", async () => {
    const { initPreserveReadingPositionOnSendFeature } =
      await import("../src/features/preserveReadingPositionOnSend");
    const { scrollRoot, form } = mountConversation();
    const handle = initPreserveReadingPositionOnSendFeature(
      makeTestContext({ preserveReadingPositionOnSend: true })
    );

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    vi.advanceTimersByTime(32);

    const baselineTop = scrollRoot.scrollTop;
    scrollRoot.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    vi.advanceTimersByTime(700);

    scrollRoot.scrollTop = baselineTop + 240;
    vi.advanceTimersByTime(32);

    expect(scrollRoot.scrollTop).toBe(baselineTop + 240);

    handle.dispose();
  });
});
