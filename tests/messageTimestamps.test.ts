import { afterEach, describe, expect, it, vi } from "vitest";
import type { DomDelta, RootSnapshot } from "../src/application/domEventBus";
import { mountHtml } from "./helpers/fixture";
import { makeTestContext } from "./helpers/testContext";

const STORAGE_KEY = "qqrmMessageTimestampsV1";
const ASSISTANT_COMPLETION_WAIT_MS = 1600;

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

function createFetchResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body
  } as Response;
}

function createDomBusHarness() {
  let mainDeltaListener: ((delta: DomDelta) => void) | null = null;
  let rootsListener: ((roots: RootSnapshot) => void) | null = null;

  return {
    domBus: {
      start: () => {},
      stop: () => {},
      dispose: () => {},
      getMainRoot: () => document.querySelector("main, [role='main']"),
      getNavRoot: () => document.querySelector("nav[aria-label='Chat history']"),
      onDelta: (channel: "main" | "nav", cb: (delta: DomDelta) => void) => {
        if (channel === "main") mainDeltaListener = cb;
        return () => {
          if (mainDeltaListener === cb) mainDeltaListener = null;
        };
      },
      onRoots: (cb: (roots: RootSnapshot) => void) => {
        rootsListener = cb;
        return () => {
          if (rootsListener === cb) rootsListener = null;
        };
      },
      getStats: () => ({
        startedAt: 0,
        channelMutations: { main: 0, nav: 0 },
        emits: { main: 0, nav: 0 },
        rebinds: 0,
        disconnects: { main: 0, nav: 0 },
        lastEmitAt: 0,
        started: true,
        disposed: false,
        mainSubs: mainDeltaListener ? 1 : 0,
        navSubs: 0,
        rootSubs: rootsListener ? 1 : 0
      }),
      stats: () => ({
        mainObserverCalls: 0,
        navObserverCalls: 0,
        mainNodes: 0,
        navNodes: 0,
        emits: 0,
        rebinds: 0
      })
    },
    emitMainAdded(...added: Element[]) {
      mainDeltaListener?.({
        channel: "main",
        added,
        removed: [],
        reason: "mutation",
        at: Date.now()
      });
    },
    emitRoots(reason: RootSnapshot["reason"] = "route") {
      rootsListener?.({
        main: document.querySelector("main, [role='main']"),
        nav: document.querySelector("nav[aria-label='Chat history']"),
        reason
      });
    }
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete (globalThis as typeof globalThis & { chrome?: unknown }).chrome;
  delete (globalThis as typeof globalThis & { browser?: unknown }).browser;
});

describe("message timestamps", () => {
  it("resolves the current conversation id from the document when the route is ambiguous", async () => {
    vi.resetModules();
    const { readConversationId, readConversationStorageKey, readCurrentConversationId } =
      await import("../src/features/chatgptConversation");

    window.history.replaceState({}, "", "/");
    mountHtml(`
      <html>
        <head>
          <link rel="canonical" href="https://chatgpt.com/c/canon-123" />
        </head>
        <body></body>
      </html>
    `);

    expect(readConversationId("/")).toBeNull();
    expect(readCurrentConversationId(document, "/")).toBe("canon-123");
    expect(readConversationStorageKey("/", document)).toBe("canon-123");
    expect(readConversationStorageKey("/c/abc123", document)).toBe("abc123");
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
                  "assistant-1": {
                    role: "assistant",
                    completedAt: 1700000060000
                  }
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
    await new Promise((resolve) => window.setTimeout(resolve, 0));
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

  it("backfills timestamps for the active chat from the conversation api", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const expectedOrigin = window.location.origin;

    (
      globalThis as typeof globalThis & {
        chrome?: { storage?: { local?: ReturnType<typeof createLocalArea> } };
      }
    ).chrome = {
      storage: {
        local: createLocalArea({
          [STORAGE_KEY]: {
            conversations: {}
          }
        })
      }
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${expectedOrigin}/api/auth/session?unstable_client=true`) {
        return createFetchResponse({ accessToken: "token-123" });
      }
      if (url === `${expectedOrigin}/backend-api/conversation/conv-123`) {
        return createFetchResponse({
          mapping: {
            "node-user": {
              message: {
                id: "user-1",
                author: { role: "user" },
                create_time: 1700000000
              }
            },
            "node-assistant": {
              message: {
                id: "assistant-1",
                author: { role: "assistant" },
                create_time: 1700000060,
                update_time: 1700000120
              }
            }
          }
        });
      }
      return createFetchResponse({}, false);
    });

    vi.stubGlobal("fetch", fetchMock);

    const { initMessageTimestampsFeature } = await import("../src/features/messageTimestamps");

    window.history.replaceState({}, "", "/");
    mountHtml(`
      <html>
        <head>
          <link rel="canonical" href="https://chatgpt.com/c/conv-123" />
        </head>
        <body>
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
        </body>
      </html>
    `);

    const handle = initMessageTimestampsFeature(makeTestContext({ showMessageTimestamps: true }));
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(450);
    await flushMicrotasks();

    const userStamp = document.querySelector<HTMLElement>(
      '[data-qqrm-message-time][data-qqrm-message-time-variant="user"]'
    );
    const assistantStamp = document.querySelector<HTMLElement>(
      '[data-qqrm-message-time][data-qqrm-message-time-variant="assistant"]'
    );

    expect(userStamp?.textContent ?? "").toMatch(/\d/);
    expect(assistantStamp?.textContent ?? "").toMatch(/\d/);
    expect(fetchMock).toHaveBeenCalledWith(
      `${expectedOrigin}/api/auth/session?unstable_client=true`,
      expect.objectContaining({ credentials: "include" })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `${expectedOrigin}/backend-api/conversation/conv-123`,
      expect.objectContaining({ credentials: "include" })
    );

    handle.dispose();
  });

  it("stamps live user and assistant messages when api backfill is unavailable", async () => {
    vi.resetModules();
    vi.useFakeTimers();

    const domBus = createDomBusHarness();
    const ctx = makeTestContext({ showMessageTimestamps: true });
    ctx.domBus = domBus.domBus as typeof ctx.domBus;

    const { initMessageTimestampsFeature } = await import("../src/features/messageTimestamps");

    window.history.replaceState({}, "", "/");
    mountHtml(`
      <main role="main"></main>
      <form data-testid="composer">
        <textarea data-testid="prompt-textarea"></textarea>
        <button id="composer-submit-button" type="submit">Send</button>
      </form>
    `);

    const handle = initMessageTimestampsFeature(ctx);
    domBus.emitRoots("initial");

    const main = document.querySelector("main");
    expect(main).not.toBeNull();

    const userMessage = document.createElement("div");
    userMessage.setAttribute("data-message-author-role", "user");
    userMessage.setAttribute("data-message-id", "live-user-1");
    userMessage.innerHTML = '<div class="user-message-bubble-color">hi</div>';
    main?.appendChild(userMessage);
    domBus.emitMainAdded(userMessage);
    await flushMicrotasks();

    const userStamp = userMessage.querySelector<HTMLElement>(
      '[data-qqrm-message-time][data-qqrm-message-time-variant="user"]'
    );
    expect(userStamp?.textContent ?? "").toMatch(/\d/);

    const assistantMessage = document.createElement("div");
    assistantMessage.setAttribute("data-message-author-role", "assistant");
    assistantMessage.setAttribute("data-message-id", "live-assistant-1");
    assistantMessage.textContent = "reply";
    main?.appendChild(assistantMessage);
    domBus.emitMainAdded(assistantMessage);

    await vi.advanceTimersByTimeAsync(ASSISTANT_COMPLETION_WAIT_MS);
    await flushMicrotasks();

    const assistantStamp = assistantMessage.querySelector<HTMLElement>(
      '[data-qqrm-message-time][data-qqrm-message-time-variant="assistant"]'
    );
    expect(assistantStamp?.textContent ?? "").toMatch(/\d/);

    handle.dispose();
  });
});
