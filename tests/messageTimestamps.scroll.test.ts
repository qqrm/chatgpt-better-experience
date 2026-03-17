import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTestContext } from "./helpers/testContext";

vi.mock("../src/features/chatgptApi", () => ({
  fetchConversationTimestampRecords: vi.fn(async () => null)
}));

function mountConversation() {
  window.history.replaceState({}, "", "/c/test-conversation");
  document.body.innerHTML = `
    <main role="main">
      <div data-scroll-root>
        <article data-message-id="user-1" data-message-author-role="user">
          <div class="user-message-bubble-color">Hello</div>
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
  if (!scrollRoot) {
    throw new Error("Missing scroll root");
  }

  let scrollTop = 0;
  Object.defineProperty(scrollRoot, "clientHeight", {
    configurable: true,
    get: () => 400
  });
  Object.defineProperty(scrollRoot, "scrollHeight", {
    configurable: true,
    get: () => 1000 + document.querySelectorAll("[data-qqrm-message-time]").length * 20
  });
  Object.defineProperty(scrollRoot, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: unknown) => {
      scrollTop = Number(value) || 0;
    }
  });

  scrollRoot.scrollTop = scrollRoot.scrollHeight - scrollRoot.clientHeight;
  return scrollRoot;
}

async function tick(count = 5) {
  for (let i = 0; i < count; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  window.history.replaceState({}, "", "/");
});

describe("messageTimestamps", () => {
  it("keeps the thread pinned to the bottom while timestamps render", async () => {
    vi.stubGlobal("browser", {
      storage: {
        local: {
          get: (
            defaults: Record<string, unknown>,
            cb: (value: Record<string, unknown>) => void
          ) => {
            cb({
              ...defaults,
              qqrmMessageTimestampsV1: {
                conversations: {
                  "test-conversation": {
                    updatedAt: 1,
                    messages: {
                      "user-1": { role: "user", sentAt: 1_740_000_000_000 },
                      "assistant-1": { role: "assistant", completedAt: 1_740_000_060_000 }
                    }
                  }
                }
              }
            });
          },
          set: (_values: Record<string, unknown>, cb: () => void) => cb()
        }
      }
    });

    const { initMessageTimestampsFeature } = await import("../src/features/messageTimestamps");
    const scrollRoot = mountConversation();
    const ctx = makeTestContext({ showMessageTimestamps: true });

    const handle = initMessageTimestampsFeature(ctx);
    await tick();

    expect(document.querySelectorAll("[data-qqrm-message-time]")).toHaveLength(2);
    expect(scrollRoot.scrollTop).toBe(scrollRoot.scrollHeight - scrollRoot.clientHeight);

    handle.dispose();
  });
});
