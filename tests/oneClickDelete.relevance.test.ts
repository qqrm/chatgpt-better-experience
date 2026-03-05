import { describe, expect, it } from "vitest";
import { isOneClickDeleteRelevantNavDelta } from "../src/features/oneClickDelete";

describe("oneClickDelete nav delta relevance", () => {
  it("treats synthetic empty deltas as relevant", () => {
    expect(isOneClickDeleteRelevantNavDelta([], [])).toBe(true);
  });

  it("ignores unrelated mutations", () => {
    const unrelated = document.createElement("div");
    unrelated.className = "sidebar-placeholder";

    expect(isOneClickDeleteRelevantNavDelta([unrelated], [])).toBe(false);
  });

  it("detects chat history rows and trailing option buttons", () => {
    const row = document.createElement("a");
    row.href = "https://chatgpt.com/c/abc123";

    const button = document.createElement("button");
    button.className = "__menu-item-trailing-btn";
    button.setAttribute("data-trailing-button", "true");

    expect(isOneClickDeleteRelevantNavDelta([row], [])).toBe(true);
    expect(isOneClickDeleteRelevantNavDelta([], [button])).toBe(true);
  });
});
