import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeExtensionContext, launchExtensionContext } from "./helpers/extension";
import { startMockServer } from "./helpers/mockServer";

const distPath = path.join(process.cwd(), "dist");
const contentScriptPath = path.join(distPath, "content.js");
const mockRoot = path.join(process.cwd(), "tests", "mock");
const artifactsDir = path.join(process.cwd(), "test-results", "e2e");

declare global {
  interface Window {
    __testStorage?: Record<string, unknown>;
    __ChatGPTDictationAutoSendLoaded__?: boolean;
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
    const listeners = new Set<
      (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void
    >();

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
        const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
        for (const [key, value] of Object.entries(values)) {
          changes[key] = { oldValue: storageData[key], newValue: value };
        }
        Object.assign(storageData, values);
        for (const listener of listeners) listener(changes, "sync");
        if (typeof cb === "function") cb();
        return Promise.resolve();
      }
    };

    const storageApi = {
      sync: storageArea,
      local: storageArea,
      onChanged: {
        addListener: (
          cb: (
            changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
            areaName: string
          ) => void
        ) => listeners.add(cb)
      }
    };

    window.__testStorage = storageData;
    window.chrome = {
      runtime: { lastError: null },
      storage: storageApi
    };
    window.browser = { storage: storageApi };
  }, initialData);
};

describe("extension e2e (mock spa)", () => {
  const state = {
    launch: null as Awaited<ReturnType<typeof launchExtensionContext>> | null,
    server: null as Awaited<ReturnType<typeof startMockServer>> | null,
    page: null as Page | null,
    errors: [] as string[]
  };
  const launchTimeoutMs = 60000;

  beforeAll(async () => {
    state.server = await startMockServer(mockRoot);
    state.launch = await launchExtensionContext();
  }, launchTimeoutMs);

  afterAll(async () => {
    if (state.page) {
      await state.page.close();
      state.page = null;
    }
    if (state.launch) {
      await closeExtensionContext(state.launch);
      state.launch = null;
    }
    if (state.server) {
      await state.server.close();
      state.server = null;
    }
  });

  beforeEach(async () => {
    if (!state.launch) throw new Error("Missing extension context");
    await state.launch.context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  });

  afterEach(async ({ task }) => {
    if (!state.launch) return;
    const { context } = state.launch;

    if (task.result?.state === "fail") {
      await mkdir(artifactsDir, { recursive: true });
      const safeName = task.name.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
      const tracePath = path.join(artifactsDir, `${safeName}.zip`);
      await context.tracing.stop({ path: tracePath });

      if (state.page) {
        const screenshotPath = path.join(artifactsDir, `${safeName}.png`);
        await state.page.screenshot({ path: screenshotPath, fullPage: true });
      }
    } else {
      await context.tracing.stop();
    }

    if (state.page) {
      await state.page.close();
      state.page = null;
    }
  });

  const openMockPage = async (settings: Record<string, unknown>) => {
    if (!state.launch || !state.server) throw new Error("Missing test state");
    const page = await state.launch.context.newPage();
    state.page = page;
    state.errors = [];

    page.on("pageerror", (error) => state.errors.push(error.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") state.errors.push(msg.text());
    });

    await addStorageStub(page, settings);
    await page.goto(`${state.server.baseUrl}/chat/index.html`);
    await page.addScriptTag({ path: contentScriptPath });
    await page.waitForFunction(() => window.__ChatGPTDictationAutoSendLoaded__ === true);

    return page;
  };

  it("OneClickDelete UI adds controls and executes delete/archive", async () => {
    const page = await openMockPage({
      autoSend: true,
      ctrlEnterSends: true,
      oneClickDelete: true,
      startDictation: true
    });

    const rows = page.locator(".chat-list .chat-row");
    const firstRow = rows.first();
    const optionsBtn = firstRow.locator(
      'button[data-testid^="history-item-"][data-testid$="-options"]'
    );

    await optionsBtn.waitFor({ state: "visible" });
    await optionsBtn.locator('span[data-qqrm-oneclick-del-x="1"]').waitFor({ state: "visible" });
    await optionsBtn.locator('span[data-qqrm-oneclick-archive="1"]').waitFor({ state: "visible" });

    const initialCount = await rows.count();
    await optionsBtn.locator('span[data-qqrm-oneclick-del-x="1"]').click();
    await firstRow.locator(".qqrm-oneclick-undo-overlay").waitFor({ state: "visible" });

    await page.waitForFunction(
      (count) => document.querySelectorAll(".chat-list .chat-row").length === count - 1,
      initialCount,
      { timeout: 15000 }
    );

    const postDeleteCount = await rows.count();
    expect(postDeleteCount).toBe(initialCount - 1);

    const nextRow = rows.first();
    const archiveCount = await rows.count();
    await nextRow.locator('span[data-qqrm-oneclick-archive="1"]').click();

    await page.waitForFunction(
      (count) => document.querySelectorAll(".chat-list .chat-row").length === count - 1,
      archiveCount,
      { timeout: 15000 }
    );

    expect(state.errors).toEqual([]);
  });

  it("Undo overlay cancels pending delete and runs on timeout", async () => {
    const page = await openMockPage({
      autoSend: true,
      ctrlEnterSends: true,
      oneClickDelete: true,
      startDictation: true
    });

    const rows = page.locator(".chat-list .chat-row");
    const firstRow = rows.first();
    const optionsBtn = firstRow.locator(
      'button[data-testid^="history-item-"][data-testid$="-options"]'
    );

    await optionsBtn.locator('span[data-qqrm-oneclick-del-x="1"]').click();
    const overlay = firstRow.locator(".qqrm-oneclick-undo-overlay");
    await overlay.waitFor({ state: "visible" });

    await overlay.click();
    await overlay.waitFor({ state: "hidden" });

    const countBefore = await rows.count();
    await optionsBtn.locator('span[data-qqrm-oneclick-del-x="1"]').click();

    await page.waitForFunction(
      (count) => document.querySelectorAll(".chat-list .chat-row").length === count - 1,
      countBefore,
      { timeout: 15000 }
    );

    expect(state.errors).toEqual([]);
  });

  it("Ctrl+Enter sends and saves edits", async () => {
    const page = await openMockPage({
      autoSend: false,
      ctrlEnterSends: true,
      oneClickDelete: true,
      startDictation: true
    });

    const prompt = page.locator("#prompt-textarea");

    await page.waitForFunction(() => document.querySelector("#sendCount")?.textContent === "0");
    await prompt.click();
    await page.keyboard.type("Hello from ctrl+enter");

    await page.keyboard.down("Control");
    await page.keyboard.press("Enter");
    await page.keyboard.up("Control");

    await page.waitForFunction(() => document.querySelector("#sendCount")?.textContent === "1");

    await page.locator("#editMsgBtn").click();
    await page.locator("#editTextarea").click();
    await page.keyboard.press("Control+Enter");

    await page.waitForFunction(() => document.querySelector("#editSaveCount")?.textContent === "1");
    await page.waitForFunction(() => document.querySelector("#sendCount")?.textContent === "1");

    expect(state.errors).toEqual([]);
  });

  it("AutoSend triggers after dictation completion", async () => {
    const page = await openMockPage({
      autoSend: true,
      ctrlEnterSends: true,
      oneClickDelete: true,
      startDictation: true
    });

    await page.waitForFunction(() => document.querySelector("#sendCount")?.textContent === "0");

    await page.locator("#dictateBtn").click();

    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("mock-dictation-complete", { detail: { text: "Mock dictation" } })
      );
    });

    await page.locator("#submitDictationBtn").click();

    await page.waitForFunction(() => document.querySelector("#sendCount")?.textContent === "1");
    await page.waitForFunction(
      () => document.querySelector("#dictationEventCount")?.textContent === "1"
    );

    expect(state.errors).toEqual([]);
  });
});
