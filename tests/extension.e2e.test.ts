// @vitest-environment node
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeExtensionContext, launchExtensionContext } from "./helpers/extension";

const fixturePath = path.join(process.cwd(), "tests", "fixtures", "content-page.html");
const fixtureUrl = pathToFileURL(fixturePath).toString();
const distPath = path.join(process.cwd(), "dist");
const popupUrl = pathToFileURL(path.join(distPath, "popup.html")).toString();
const contentScriptPath = path.join(distPath, "content.js");

declare global {
  interface Window {
    __testStorage?: Record<string, unknown>;
    chrome?: {
      runtime?: { lastError?: unknown };
      storage?: {
        sync?: unknown;
        local?: unknown;
      };
    };
    browser?: {
      storage?: {
        sync?: unknown;
        local?: unknown;
      };
    };
  }
}

const addStorageStub = async (page: Page, initialData: Record<string, unknown>) => {
  await page.addInitScript((seed) => {
    const storageData: Record<string, unknown> = { ...seed };
    const pick = (keys: string[] | Record<string, unknown> | null | undefined) => {
      const res: Record<string, unknown> = {};
      if (Array.isArray(keys)) {
        for (const key of keys) {
          if (Object.prototype.hasOwnProperty.call(storageData, key)) {
            res[key] = storageData[key];
          }
        }
        return res;
      }
      if (keys && typeof keys === "object") {
        for (const key of Object.keys(keys)) {
          if (Object.prototype.hasOwnProperty.call(storageData, key)) {
            res[key] = storageData[key];
          }
        }
      }
      return res;
    };
    const storageArea = {
      get: (
        keys: string[] | Record<string, unknown>,
        cb?: (res: Record<string, unknown>) => void
      ) => {
        const res = pick(keys);
        if (typeof cb === "function") cb(res);
        return Promise.resolve(res);
      },
      set: (values: Record<string, unknown>, cb?: () => void) => {
        Object.assign(storageData, values);
        if (typeof cb === "function") cb();
        return Promise.resolve();
      }
    };
    window.__testStorage = storageData;
    window.chrome = {
      runtime: { lastError: null },
      storage: { sync: storageArea, local: storageArea }
    };
    window.browser = { storage: { sync: storageArea, local: storageArea } };
  }, initialData);
};

describe("extension e2e", () => {
  const state = {
    launch: null as Awaited<ReturnType<typeof launchExtensionContext>> | null
  };
  const launchTimeoutMs = 30000;

  beforeAll(async () => {
    state.launch = await launchExtensionContext();
  }, launchTimeoutMs);

  afterAll(async () => {
    if (state.launch) {
      await closeExtensionContext(state.launch);
    }
  });

  it("opens popup and persists settings", async () => {
    if (!state.launch) throw new Error("Missing extension context");
    const { context } = state.launch;

    const page = await context.newPage();
    await addStorageStub(page, {
      autoSend: false,
      autoExpandChats: false,
      autoTempChat: true,
      tempChatEnabled: true,
      oneClickDelete: true,
      wideChatWidth: 35
    });
    await page.goto(popupUrl);
    await page.waitForSelector("#autoSend");

    expect(await page.isChecked("#autoSend")).toBe(false);
    expect(await page.isChecked("#autoExpandChats")).toBe(false);
    expect(await page.isChecked("#autoTempChat")).toBe(true);
    expect(await page.isChecked("#oneClickDelete")).toBe(true);
    expect(await page.inputValue("#wideChatWidth")).toBe("35");

    await page.setChecked("#autoSend", true);
    await page.setChecked("#autoExpandChats", true);
    await page.setChecked("#autoTempChat", false);
    await page.setChecked("#oneClickDelete", false);
    await page.$eval(
      "#wideChatWidth",
      (el, value) => {
        const input = el as HTMLInputElement;
        input.value = String(value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      },
      "80"
    );

    await page.waitForFunction(() => {
      const data = window.__testStorage ?? {};
      return (
        data.autoSend === true &&
        data.autoExpandChats === true &&
        data.autoTempChat === false &&
        data.tempChatEnabled === false &&
        data.oneClickDelete === false &&
        data.wideChatWidth === 80
      );
    });

    await page.close();
  });

  it("injects content script and reacts to temp chat DOM", async () => {
    if (!state.launch) throw new Error("Missing extension context");
    const { context } = state.launch;

    const page = await context.newPage();

    await addStorageStub(page, {
      autoSend: true,
      autoExpandChats: true,
      autoTempChat: true,
      tempChatEnabled: true
    });

    await page.goto(fixtureUrl);
    await page.addScriptTag({ path: contentScriptPath });

    await page.waitForFunction(() => document.body.dataset.tempChat === "enabled", null, {
      timeout: 5000
    });

    expect(await page.isChecked("#temporary-chat-checkbox")).toBe(true);

    await page.close();
  });
});
