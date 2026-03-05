import { describe, expect, it } from "vitest";
import { isAutoExpandProjectsRelevantNavDelta } from "../src/features/autoExpandProjects";

describe("autoExpandProjects nav delta relevance", () => {
  it("treats synthetic empty deltas as relevant", () => {
    expect(isAutoExpandProjectsRelevantNavDelta([], [])).toBe(true);
  });

  it("ignores unrelated nav mutations", () => {
    const unrelated = document.createElement("div");
    unrelated.textContent = "plain nav content";

    expect(isAutoExpandProjectsRelevantNavDelta([unrelated], [])).toBe(false);
  });

  it("detects project links and section controls", () => {
    const projectLink = document.createElement("a");
    projectLink.href = "https://chatgpt.com/project/alpha";

    const section = document.createElement("div");
    section.className = "sidebar-expando-section";

    expect(isAutoExpandProjectsRelevantNavDelta([projectLink], [])).toBe(true);
    expect(isAutoExpandProjectsRelevantNavDelta([], [section])).toBe(true);
  });
});
