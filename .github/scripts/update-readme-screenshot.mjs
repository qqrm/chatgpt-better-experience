import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch (error) {
  if (error?.code === "ERR_MODULE_NOT_FOUND") {
    console.warn(
      'Skipping README screenshot update: optional dependency "playwright" is not installed.'
    );
    process.exit(0);
  }

  throw error;
}

const popupPath = resolve("popup.html");
const screenshotPath = resolve("docs/images/popup-dark.jpeg");
const readmePath = resolve("README.md");
const markerStart = "<!-- popup-screenshot:start -->";
const markerEnd = "<!-- popup-screenshot:end -->";
const popupDefaults = {
  autoSend: true,
  allowAutoSendInCodex: true,
  editLastMessageOnArrowUp: true,
  autoExpandChats: true,
  autoExpandProjects: true,
  autoExpandProjectItems: false,
  autoTempChat: false,
  oneClickDelete: true,
  startDictation: false,
  ctrlEnterSends: true,
  trimChatDom: false,
  hideShareButton: false
};

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({
    viewport: { width: 320, height: 900 },
    colorScheme: "dark"
  });

  await page.goto(`file://${popupPath}`, { waitUntil: "load" });
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "dark");
    const toggle = document.getElementById("qqrm-theme-toggle");
    if (toggle) toggle.setAttribute("data-mode", "dark");
  });
  await page.waitForFunction(
    ({ expected }) => {
      return Object.entries(expected).every(([id, value]) => {
        const el = document.getElementById(id);
        return el instanceof HTMLInputElement && el.checked === value;
      });
    },
    { expected: popupDefaults }
  );
  await page.waitForTimeout(150);

  await page.locator("body").screenshot({
    path: screenshotPath,
    type: "jpeg",
    quality: 90
  });

  const readme = readFileSync(readmePath, "utf8");
  const replacement = [
    markerStart,
    "![Extension popup in dark theme](docs/images/popup-dark.jpeg)",
    markerEnd
  ].join("\n");

  const pattern = new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`);
  const next = pattern.test(readme)
    ? readme.replace(pattern, replacement)
    : `${readme.trimEnd()}\n\n## UI preview\n\n${replacement}\n`;

  writeFileSync(readmePath, next);
} finally {
  await browser.close();
}
