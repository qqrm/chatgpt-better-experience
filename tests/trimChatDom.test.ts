import { describe, it, expect } from "vitest";
import { makeTestContext } from "./helpers/testContext";
import { initTrimChatDomFeature } from "../src/features/trimChatDom";

function mountMinimalChat(turns: number) {
  const parts: string[] = [];
  parts.push('<main id="root">');
  for (let i = 0; i < turns; i++) {
    parts.push(`<article data-i="${i}"><div data-message-author-role="user">u${i}</div></article>`);
  }
  parts.push("</main>");
  document.open();
  document.write(parts.join(""));
  document.close();
}

async function tick(n = 3) {
  for (let i = 0; i < n; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe("trimChatDom", () => {
  it("hides older turns and provides restore controls without reload", async () => {
    mountMinimalChat(12);

    const ctx = makeTestContext({
      trimChatDom: true,
      trimChatDomKeep: 5
    });

    const handle = initTrimChatDomFeature(ctx);

    // allow RAF + mutation observer to run enforce()
    await tick(5);

    const hidden = Array.from(document.querySelectorAll("article")).filter(
      (a) => (a as HTMLElement).getAttribute("data-qqrm-trimmed") === "1"
    );
    expect(hidden.length).toBe(7);

    const placeholder = document.getElementById("qqrm-trim-chat-dom-placeholder");
    expect(placeholder).toBeTruthy();

    const btn = placeholder!.querySelector<HTMLButtonElement>(
      'button[data-qqrm-restore="quarter"]'
    );
    expect(btn).toBeTruthy();

    // restore 25% of hidden
    btn!.click();
    await tick(5);

    const hiddenAfter = Array.from(document.querySelectorAll("article")).filter(
      (a) => (a as HTMLElement).getAttribute("data-qqrm-trimmed") === "1"
    );

    // 7 hidden -> restore ceil(7*0.25)=2, so 5 hidden left.
    expect(hiddenAfter.length).toBe(5);

    handle.dispose();
  });
});
