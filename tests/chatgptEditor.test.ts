import { describe, expect, it } from "vitest";
import { findAnyEditSubmitButton, findEditSubmitButton } from "../src/features/chatgptEditor";

function resetDom(html: string) {
  document.documentElement.innerHTML = "<head></head><body></body>";
  document.body.innerHTML = html;
}

describe("chatgptEditor", () => {
  it("does not treat the main composer as edit mode", () => {
    resetDom(`
      <div id="thread-bottom-container">
        <div id="thread-bottom">
          <form>
            <div id="prompt-textarea" contenteditable="true"></div>
            <button data-testid="send-button">Send</button>
          </form>
        </div>
      </div>
    `);

    const composer = document.getElementById("prompt-textarea") as HTMLElement;
    expect(composer).toBeTruthy();
    expect(findEditSubmitButton(composer)).toBeNull();
  });

  it("finds the edit apply button near an edit composer", () => {
    resetDom(`
      <article>
        <div data-message-author-role="user">
          <div class="edit-ui">
            <textarea></textarea>
            <div class="actions">
              <button>Cancel</button>
              <button style="position: fixed;">Send</button>
            </div>
          </div>
        </div>
      </article>
    `);

    const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
    const button = findEditSubmitButton(textarea);
    expect(button).toBeTruthy();
    expect((button as HTMLElement).textContent).toContain("Send");
  });

  it("globally finds an edit apply button even when a main composer exists", () => {
    resetDom(`
      <div id="thread-bottom-container">
        <div id="thread-bottom">
          <form>
            <div id="prompt-textarea" contenteditable="true"></div>
            <button data-testid="send-button">Send</button>
          </form>
        </div>
      </div>

      <article>
        <div data-message-author-role="user">
          <div class="edit-ui">
            <textarea></textarea>
            <div class="actions">
              <button>Cancel</button>
              <button>Save and submit</button>
            </div>
          </div>
        </div>
      </article>
    `);

    const globalButton = findAnyEditSubmitButton();
    expect(globalButton).toBeTruthy();
    expect((globalButton as HTMLElement).textContent?.toLowerCase()).toContain("save");
  });
});
