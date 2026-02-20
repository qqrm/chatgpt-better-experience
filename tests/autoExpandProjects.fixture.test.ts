import { describe, it, expect } from "vitest";
import type { FeatureContext } from "../src/application/featureContext";
import { loadFixtureHtml, mountHtml } from "./helpers/fixture";
import { makeTestContext } from "./helpers/testContext";
import { initAutoExpandProjectsFeature } from "../src/features/autoExpandProjects";

type AutoExpandProjectsTestApi = {
  getChatHistoryNav: (ctx: FeatureContext) => HTMLElement | null;
  findProjectsSection: (nav: HTMLElement) => HTMLElement | null;
  runOnce: (
    ctx: FeatureContext,
    reason: string
  ) => {
    stats: { projectsExpanded: boolean; projectRows: number; folderClicks: number };
    done: boolean;
  };
};

describe("autoExpandProjects (DOM fixture contract)", () => {
  it("finds chat history nav and projects section on captured fixture", () => {
    const html = loadFixtureHtml("tests/fixtures/chatgpt-fixture-2026-02-04-17-23-37.html");
    mountHtml(html);

    const ctx = makeTestContext({
      autoExpandProjects: true,
      autoExpandProjectItems: false
    });

    const handle = initAutoExpandProjectsFeature(ctx);

    const t = handle.__test as unknown as AutoExpandProjectsTestApi;

    expect(t).toBeTruthy();
    expect(typeof t.getChatHistoryNav).toBe("function");
    expect(typeof t.findProjectsSection).toBe("function");
    expect(typeof t.runOnce).toBe("function");

    const nav = t.getChatHistoryNav(ctx);
    expect(nav).toBeTruthy();

    const section = t.findProjectsSection(nav!);
    expect(section).toBeTruthy();

    const result = t.runOnce(ctx, "test");
    expect(typeof result.stats.projectRows).toBe("number");
    expect(result.stats.projectRows).toBeGreaterThanOrEqual(0);

    handle.dispose();
  });
});
