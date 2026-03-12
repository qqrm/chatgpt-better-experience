import { afterEach, describe, expect, it, vi } from "vitest";
import { mountHtml } from "./helpers/fixture";
import { makeTestContext } from "./helpers/testContext";

const STORAGE_KEY = "qqrmMessageTimestampsV1";

function createLocalArea(snapshot: Record<string, unknown>) {
  const data = { ...snapshot };

  return {
    get(defaults: Record<string, unknown>, cb: (res: Record<string, unknown>) => void) {
      cb({ ...defaults, ...data });
    },
    set(values: Record<string, unknown>, cb: () => void) {
      Object.assign(data, values);
      cb();
    }
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await Promise.resolve();
}

afterEach(() => {
  delete (globalThis as typeof globalThis & { chrome?: unknown }).chrome;
  delete (globalThis as typeof globalThis & { browser?: unknown }).browser;
});

describe("message timestamps", () => {
  it("uses a stable storage key for root and thread routes", async () => {
    vi.resetModules();
    const { readConversationId, readConversationStorageKey } =
      await import("../src/features/chatgptConversation");

    expect(readConversationId("/")).toBeNull();
    expect(readConversationStorageKey("/")).toBe("path:/");
    expect(readConversationStorageKey("/g/g-p-123")).toBe("path:/g/g-p-123");
    expect(readConversationStorageKey("/c/abc123")).toBe("abc123");
  });

  it("renders persisted timestamps for root-path conversations", async () => {
    vi.resetModules();

    (
      globalThis as typeof globalThis & {
        chrome?: { storage?: { local?: ReturnType<typeof createLocalArea> } };
      }
    ).chrome = {
      storage: {
        local: createLocalArea({
          [STORAGE_KEY]: {
            conversations: {
              "path:/": {
                updatedAt: 1700000001000,
                messages: {
                  "user-1": { role: "user", sentAt: 1700000000000 },
                  "assistant-1": { role: "assistant", completedAt: 1700000060000 }
                }
              }
            }
          }
        })
      }
    };

    const { initMessageTimestampsFeature } = await import("../src/features/messageTimestamps");

    window.history.replaceState({}, "", "/");
    mountHtml(`
      <main role="main">
        <div data-message-author-role="user" data-message-id="user-1">
          <div class="user-message-bubble-color">hello</div>
        </div>
        <div data-message-author-role="assistant" data-message-id="assistant-1">
          world
        </div>
      </main>
      <form data-testid="composer">
        <textarea data-testid="prompt-textarea"></textarea>
        <button id="composer-submit-button" type="submit">Send</button>
      </form>
    `);

    const handle = initMessageTimestampsFeature(makeTestContext({ showMessageTimestamps: true }));
    await flushMicrotasks();

    const userStamp = document.querySelector<HTMLElement>(
      '[data-qqrm-message-time][data-qqrm-message-time-variant="user"]'
    );
    const assistantStamp = document.querySelector<HTMLElement>(
      '[data-qqrm-message-time][data-qqrm-message-time-variant="assistant"]'
    );

    expect(userStamp?.textContent ?? "").toMatch(/\d/);
    expect(assistantStamp?.textContent ?? "").toMatch(/\d/);

    handle.dispose();
  });
});
