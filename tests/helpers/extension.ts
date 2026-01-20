import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BrowserContext, chromium } from "playwright";

export type ExtensionLaunch = {
  context: BrowserContext;
  userDataDir: string;
};

const extensionPath = path.resolve(process.cwd(), "dist");

export async function launchExtensionContext(): Promise<ExtensionLaunch> {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "playwright-extension-"));
  const headless = process.env.CI === "true" || !process.env.DISPLAY;
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    ignoreDefaultArgs: ["--disable-extensions"]
  });
  return { context, userDataDir };
}

export async function closeExtensionContext({ context, userDataDir }: ExtensionLaunch) {
  await context.close();
  await rm(userDataDir, { recursive: true, force: true });
}
