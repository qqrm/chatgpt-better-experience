import { describe, expect, it } from "vitest";
import { createFeatureContext } from "../src/application/featureContext";
import { SETTINGS_DEFAULTS } from "../src/domain/settings";

const storagePort = {
  get: async <T extends Record<string, unknown>>(defaults: T): Promise<T> => defaults,
  set: async () => {}
};

describe("featureContext wait helpers", () => {
  it("waitPresent resolves when node appears later", async () => {
    document.body.innerHTML = `<div id="root"></div>`;
    const ctx = createFeatureContext({
      settings: SETTINGS_DEFAULTS,
      storagePort,
      debugEnabled: false
    });

    const root = document.getElementById("root") as HTMLElement;
    const waiting = ctx.helpers.waitPresent(".late", root, 300);

    window.setTimeout(() => {
      const el = document.createElement("div");
      el.className = "late";
      root.appendChild(el);
    }, 25);

    const found = await waiting;
    expect(found).toBeTruthy();
    expect(found?.className).toBe("late");
  });

  it("waitPresent returns null after timeout", async () => {
    document.body.innerHTML = `<div id="root"></div>`;
    const ctx = createFeatureContext({
      settings: SETTINGS_DEFAULTS,
      storagePort,
      debugEnabled: false
    });

    const root = document.getElementById("root") as HTMLElement;
    const found = await ctx.helpers.waitPresent(".never", root, 30);
    expect(found).toBeNull();
  });

  it("waitGone resolves true when node disappears later", async () => {
    document.body.innerHTML = `<div id="root"><span class="target"></span></div>`;
    const ctx = createFeatureContext({
      settings: SETTINGS_DEFAULTS,
      storagePort,
      debugEnabled: false
    });

    const root = document.getElementById("root") as HTMLElement;
    const waiting = ctx.helpers.waitGone(".target", root, 300);

    window.setTimeout(() => {
      root.querySelector(".target")?.remove();
    }, 25);

    await expect(waiting).resolves.toBe(true);
  });

  it("waitGone resolves based on final state at timeout", async () => {
    document.body.innerHTML = `<div id="root"><span class="target"></span></div>`;
    const ctx = createFeatureContext({
      settings: SETTINGS_DEFAULTS,
      storagePort,
      debugEnabled: false
    });

    const root = document.getElementById("root") as HTMLElement;
    const stillPresent = await ctx.helpers.waitGone(".target", root, 30);
    expect(stillPresent).toBe(false);
  });
});
