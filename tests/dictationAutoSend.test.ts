import { afterEach, describe, expect, it, vi } from "vitest";
import { initDictationAutoSendFeature } from "../src/features/dictationAutoSend";
import { makeTestContext } from "./helpers/testContext";

type DictationTestApi = {
  getDictationUiState: () => "NONE" | "STOP" | "SUBMIT";
  findSubmitDictationButton: () => HTMLElement | null;
  runAutoSendFlow?: (snapshotOverride?: string, initialShiftHeld?: boolean) => Promise<void> | void;
};

describe("dictationAutoSend", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("does not classify regular send button as dictation submit during UI rebind", async () => {
    vi.useFakeTimers();

    document.body.innerHTML = `
      <main role="main">
        <form data-testid="composer">
          <div id="prompt-textarea" contenteditable="true">Черновик сообщения</div>
          <div data-testid="composer-footer-actions">
            <button
              id="composer-submit-button"
              data-testid="send-button"
              aria-label="Submit"
              title="Send message"
            >
              Send
            </button>
          </div>
        </form>
      </main>
    `;

    let pathChangeHandler: ((path: string) => void) | null = null;
    const humanClickCalls: string[] = [];
    const flowStartLogs: string[] = [];

    const ctx = makeTestContext({ autoSend: true, allowAutoSendInCodex: true });
    ctx.helpers.humanClick = (_el, why) => {
      humanClickCalls.push(why);
      return true;
    };
    ctx.helpers.onPathChange = (cb) => {
      pathChangeHandler = cb;
      return () => {
        pathChangeHandler = null;
      };
    };
    ctx.logger.debug = (scope, message) => {
      if (scope === "FLOW" && message === "submit click flow start") {
        flowStartLogs.push(message);
      }
    };

    const handle = initDictationAutoSendFeature(ctx);
    const testApi = handle.__test as DictationTestApi;

    expect(testApi.findSubmitDictationButton()).toBeNull();
    expect(testApi.getDictationUiState()).toBe("NONE");

    const footer = document.querySelector('[data-testid="composer-footer-actions"]');
    expect(footer).not.toBeNull();

    footer?.replaceChildren();
    footer?.insertAdjacentHTML(
      "beforeend",
      `
        <button
          id="composer-submit-button"
          data-testid="send-button"
          aria-label="Done"
          title="Send"
        >
          Done
        </button>
      `
    );

    await vi.runOnlyPendingTimersAsync();

    const rebindPathHandler: (path: string) => void = pathChangeHandler ?? (() => {});
    rebindPathHandler("/chat/rebound");
    await vi.runOnlyPendingTimersAsync();

    expect(testApi.findSubmitDictationButton()).toBeNull();
    expect(testApi.getDictationUiState()).toBe("NONE");
    expect(flowStartLogs).toHaveLength(0);
    expect(humanClickCalls).not.toContain("submit-dictation");

    handle.dispose();
  });

  it("still detects dictation submit when Done is next to dictation controls", () => {
    document.body.innerHTML = `
      <main role="main">
        <div data-testid="composer-footer-actions">
          <button type="button" aria-label="Dictate button">🎙️</button>
          <button type="button" aria-label="Done" title="Done">Done</button>
        </div>
      </main>
    `;

    const handle = initDictationAutoSendFeature(
      makeTestContext({ autoSend: true, allowAutoSendInCodex: true })
    );
    const testApi = handle.__test as DictationTestApi;

    const submitBtn = testApi.findSubmitDictationButton();
    expect(submitBtn).not.toBeNull();
    expect(submitBtn?.getAttribute("aria-label")).toBe("Done");
    expect(testApi.getDictationUiState()).toBe("SUBMIT");

    handle.dispose();
  });

  it("still detects explicit dictation submit markers", () => {
    document.body.innerHTML = `
      <main role="main">
        <div data-testid="composer-footer-actions">
          <button type="button" data-testid="dictation-submit" aria-label="Submit">Submit</button>
        </div>
      </main>
    `;

    const handle = initDictationAutoSendFeature(
      makeTestContext({ autoSend: true, allowAutoSendInCodex: true })
    );
    const testApi = handle.__test as DictationTestApi;

    const submitBtn = testApi.findSubmitDictationButton();
    expect(submitBtn).not.toBeNull();
    expect(submitBtn?.getAttribute("data-testid")).toBe("dictation-submit");
    expect(testApi.getDictationUiState()).toBe("SUBMIT");

    handle.dispose();
  });

  it("auto-send flow clicks Send after final text stabilizes", async () => {
    vi.useFakeTimers();
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => Date.now());

    document.body.innerHTML = `
      <main role="main">
        <form data-testid="composer">
          <div id="prompt-textarea" contenteditable="true"></div>
          <div data-testid="composer-footer-actions">
            <button type="button" aria-label="Dictate button">🎙️</button>
            <button type="button" aria-label="Submit dictation" title="Submit dictation">Done</button>
            <button
              id="composer-submit-button"
              data-testid="send-button"
              aria-label="Send"
              title="Send message"
              type="submit"
            >
              Send
            </button>
          </div>
        </form>
      </main>
    `;

    const humanClickCalls: string[] = [];
    const ctx = makeTestContext({ autoSend: true, allowAutoSendInCodex: true });
    ctx.helpers.humanClick = (_el, why) => {
      humanClickCalls.push(why);
      if (why === "send") {
        const input = document.getElementById("prompt-textarea") as HTMLElement | null;
        if (input) {
          input.textContent = "";
          input.innerText = "";
        }
      }
      return true;
    };

    const handle = initDictationAutoSendFeature(ctx);
    const testApi = handle.__test as DictationTestApi;
    expect(testApi.runAutoSendFlow).toBeTypeOf("function");

    const flow = testApi.runAutoSendFlow?.("", false);

    const input = document.getElementById("prompt-textarea") as HTMLElement;
    input.textContent = "Привет";
    input.innerText = "Привет";

    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve(flow);

    expect(humanClickCalls).toContain("send");

    handle.dispose();
    nowSpy.mockRestore();
  });

  it("auto-send flow does not click Send when Shift cancels the in-flight submit", async () => {
    vi.useFakeTimers();
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => Date.now());

    document.body.innerHTML = `
      <main role="main">
        <form data-testid="composer">
          <div id="prompt-textarea" contenteditable="true"></div>
          <div data-testid="composer-footer-actions">
            <button type="button" aria-label="Dictate button">🎙️</button>
            <button type="button" aria-label="Submit dictation" title="Submit dictation">Done</button>
            <button id="composer-submit-button" data-testid="send-button" aria-label="Send" type="submit">
              Send
            </button>
          </div>
        </form>
      </main>
    `;

    const humanClickCalls: string[] = [];
    const ctx = makeTestContext({ autoSend: true, allowAutoSendInCodex: true });
    ctx.helpers.humanClick = (_el, why) => {
      humanClickCalls.push(why);
      return true;
    };

    const handle = initDictationAutoSendFeature(ctx);
    const testApi = handle.__test as DictationTestApi;
    expect(testApi.runAutoSendFlow).toBeTypeOf("function");

    const flow = testApi.runAutoSendFlow?.("", false);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", bubbles: true }));

    const input = document.getElementById("prompt-textarea") as HTMLElement;
    input.textContent = "Текст после диктовки";
    input.innerText = "Текст после диктовки";

    await vi.advanceTimersByTimeAsync(700);
    await Promise.resolve(flow);

    expect(humanClickCalls).not.toContain("send");

    handle.dispose();
    nowSpy.mockRestore();
  });
});
