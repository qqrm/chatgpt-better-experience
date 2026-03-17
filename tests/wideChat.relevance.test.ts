import { describe, expect, it } from "vitest";
import { isWideChatRelevantMainDelta } from "../src/features/wideChat";

describe("wideChat main delta relevance", () => {
  it("ignores the floating scroll-to-bottom button outside conversation turns", () => {
    const overlay = document.createElement("div");
    overlay.className = "relative h-0";

    const container = document.createElement("div");
    const button = document.createElement("button");
    button.className = "scroll-to-bottom";

    container.appendChild(button);
    overlay.appendChild(container);

    expect(isWideChatRelevantMainDelta([overlay], [])).toBe(false);
    expect(isWideChatRelevantMainDelta([button], [])).toBe(false);
  });

  it("still reacts to controls inserted inside a conversation turn", () => {
    const article = document.createElement("article");
    const message = document.createElement("div");
    message.setAttribute("data-message-author-role", "assistant");
    const button = document.createElement("button");

    article.appendChild(message);
    article.appendChild(button);

    expect(isWideChatRelevantMainDelta([article], [])).toBe(true);
    expect(isWideChatRelevantMainDelta([button], [])).toBe(true);
  });
});
