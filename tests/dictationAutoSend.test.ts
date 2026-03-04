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

  it("installs click handler on window capture (not document)", () => {
    const winAdd = vi.spyOn(window, "addEventListener");
    const docAdd = vi.spyOn(document, "addEventListener");

    const handle = initDictationAutoSendFeature(
      makeTestContext({ autoSend: true, allowAutoSendInCodex: true })
    );

    const windowHasClickCapture = winAdd.mock.calls.some((c) => c[0] === "click" && c[2] === true);
    const documentHasClick = docAdd.mock.calls.some((c) => c[0] === "click");

    expect(windowHasClickCapture).toBe(true);
    expect(documentHasClick).toBe(false);

    handle.dispose();
    winAdd.mockRestore();
    docAdd.mockRestore();
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

  it("detects Submit dictation even when it is inside the composer form", () => {
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

    const handle = initDictationAutoSendFeature(
      makeTestContext({ autoSend: true, allowAutoSendInCodex: true })
    );
    const testApi = handle.__test as DictationTestApi;

    const submitBtn = testApi.findSubmitDictationButton();
    expect(submitBtn).not.toBeNull();
    expect(submitBtn?.getAttribute("aria-label")).toBe("Submit dictation");
    expect(testApi.getDictationUiState()).toBe("SUBMIT");

    handle.dispose();
  });

  it("auto-send flow submits composer after final text stabilizes", async () => {
    vi.useFakeTimers();
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => Date.now());

    document.body.innerHTML = `
      <main role="main">
        <form data-testid="composer">
          <div id="prompt-textarea" contenteditable="true"></div>
          <div data-testid="composer-footer-actions">
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

    const ctx = makeTestContext({ autoSend: true, allowAutoSendInCodex: true });
    const humanClickCalls: string[] = [];
    ctx.helpers.humanClick = (_el, why) => {
      humanClickCalls.push(why);
      return true;
    };

    const handle = initDictationAutoSendFeature(ctx);
    const testApi = handle.__test as DictationTestApi;
    expect(testApi.runAutoSendFlow).toBeTypeOf("function");

    const form = document.querySelector('form[data-testid="composer"]') as HTMLFormElement;
    const input = document.getElementById("prompt-textarea") as HTMLElement;
    const requestSubmit = vi.fn(() => {
      input.textContent = "";
      input.innerText = "";
    });
    (form as unknown as { requestSubmit: unknown }).requestSubmit = requestSubmit;

    const flow = testApi.runAutoSendFlow?.("", false);

    input.textContent = "Привет";
    input.innerText = "Привет";

    await vi.advanceTimersByTimeAsync(2500);
    expect(requestSubmit).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(1200);
    await Promise.resolve(flow);

    expect(requestSubmit).toHaveBeenCalledTimes(1);
    expect(humanClickCalls).not.toContain("send");

    handle.dispose();
    nowSpy.mockRestore();
  });

  it("auto-send flow reads composer input even if another contenteditable is focused", async () => {
    vi.useFakeTimers();
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => Date.now());

    document.body.innerHTML = `
      <main role="main">
        <div id="other" contenteditable="true"></div>
        <form data-testid="composer">
          <div id="prompt-textarea" contenteditable="true"></div>
          <div data-testid="composer-footer-actions">
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

    const other = document.getElementById("other") as HTMLElement;
    other.focus();

    const ctx = makeTestContext({ autoSend: true, allowAutoSendInCodex: true });
    ctx.helpers.humanClick = () => true;

    const handle = initDictationAutoSendFeature(ctx);
    const testApi = handle.__test as DictationTestApi;
    expect(testApi.runAutoSendFlow).toBeTypeOf("function");

    const form = document.querySelector('form[data-testid="composer"]') as HTMLFormElement;
    const input = document.getElementById("prompt-textarea") as HTMLElement;
    const requestSubmit = vi.fn(() => {
      input.textContent = "";
      input.innerText = "";
    });
    (form as unknown as { requestSubmit: unknown }).requestSubmit = requestSubmit;

    const flow = testApi.runAutoSendFlow?.("", false);
    input.textContent = "Текст";
    input.innerText = "Текст";

    await vi.advanceTimersByTimeAsync(26000);
    await Promise.resolve(flow);

    expect(requestSubmit).toHaveBeenCalledTimes(1);

    handle.dispose();
    nowSpy.mockRestore();
  });

  it("auto-send flow does not submit when Shift cancels during countdown", async () => {
    vi.useFakeTimers();
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => Date.now());

    document.body.innerHTML = `
      <main role="main">
        <form data-testid="composer">
          <div id="prompt-textarea" contenteditable="true"></div>
          <div data-testid="composer-footer-actions">
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

    const ctx = makeTestContext({ autoSend: true, allowAutoSendInCodex: true });
    ctx.helpers.humanClick = () => true;

    const handle = initDictationAutoSendFeature(ctx);
    const testApi = handle.__test as DictationTestApi;
    expect(testApi.runAutoSendFlow).toBeTypeOf("function");

    const form = document.querySelector('form[data-testid="composer"]') as HTMLFormElement;
    const input = document.getElementById("prompt-textarea") as HTMLElement;
    const requestSubmit = vi.fn(() => {
      input.textContent = "";
      input.innerText = "";
    });
    (form as unknown as { requestSubmit: unknown }).requestSubmit = requestSubmit;

    const flow = testApi.runAutoSendFlow?.("", false);
    input.textContent = "Текст";
    input.innerText = "Текст";

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1500);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", bubbles: true }));
    await vi.advanceTimersByTimeAsync(2600);
    await Promise.resolve(flow);

    expect(requestSubmit).toHaveBeenCalledTimes(0);

    handle.dispose();
    nowSpy.mockRestore();
  });
});
