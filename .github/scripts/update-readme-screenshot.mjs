import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const popupPath = resolve("popup.html");
const screenshotPath = resolve("docs/images/popup-dark.png");
const readmePath = resolve("README.md");
const markerStart = "<!-- popup-screenshot:start -->";
const markerEnd = "<!-- popup-screenshot:end -->";

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
  await page.waitForTimeout(150);

  await page.locator("body").screenshot({ path: screenshotPath });

  const readme = readFileSync(readmePath, "utf8");
  const replacement = [
    markerStart,
    "![Extension popup in dark theme](docs/images/popup-dark.png)",
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
