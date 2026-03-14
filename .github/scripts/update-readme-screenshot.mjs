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

const popupPath = resolve("dist/popup.html");
const screenshotPath = resolve("docs/images/popup-dark.jpeg");
const readmePath = resolve("README.md");
const markerStart = "<!-- popup-screenshot:start -->";
const markerEnd = "<!-- popup-screenshot:end -->";
const tabIds = [
  "tab-automation",
  "tab-input",
  "tab-sidebar",
  "tab-performance",
  "tab-codex",
  "tab-dev"
];
const gridColumns = 3;
const gridGapPx = 12;
const gridPaddingPx = 12;
const popupDefaults = {
  autoSend: true,
  allowAutoSendInCodex: true,
  editLastMessageOnArrowUp: true,
  autoExpandChats: true,
  autoExpandProjects: true,
  autoExpandProjectItems: true,
  autoTempChat: false,
  oneClickDelete: true,
  startDictation: false,
  ctrlEnterSends: true,
  trimChatDom: false,
  hideShareButton: false
};
const popupPreview = {
  settings: {
    autoExpandProjectItems: true
  },
  forceAutoExpandProjectsDropdownOpen: true,
  registry: {
    version: 1,
    entriesByHref: {
      "/project/orion": {
        href: "/project/orion",
        title: "Orion",
        lastSeenAt: 500,
        lastSeenOrder: 0
      },
      "/project/quasar": {
        href: "/project/quasar",
        title: "Quasar",
        lastSeenAt: 500,
        lastSeenOrder: 1
      },
      "/project/lynx": {
        href: "/project/lynx",
        title: "Lynx",
        lastSeenAt: 500,
        lastSeenOrder: 2
      },
      "/project/otter": {
        href: "/project/otter",
        title: "Otter",
        lastSeenAt: 500,
        lastSeenOrder: 3
      },
      "/project/capybara-lab": {
        href: "/project/capybara-lab",
        title: "Capybara Lab",
        lastSeenAt: 500,
        lastSeenOrder: 4
      }
    }
  },
  prefs: {
    version: 1,
    expandedByHref: {
      "/project/orion": true,
      "/project/quasar": false,
      "/project/lynx": true,
      "/project/otter": false,
      "/project/capybara-lab": true
    }
  }
};

const browser = await chromium.launch({ headless: true });

try {
  const popupPage = await browser.newPage({
    viewport: { width: 320, height: 900 },
    colorScheme: "dark"
  });

  await popupPage.addInitScript((preview) => {
    window.__CBE_POPUP_PREVIEW__ = preview;
  }, popupPreview);
  await popupPage.goto(`file://${popupPath}`, { waitUntil: "load" });
  await popupPage.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "dark");
    const toggle = document.getElementById("qqrm-theme-toggle");
    if (toggle) toggle.setAttribute("data-mode", "dark");
  });
  await popupPage.waitForFunction(
    ({ expected }) => {
      return Object.entries(expected).every(([id, value]) => {
        const el = document.getElementById(id);
        return el instanceof HTMLInputElement && el.checked === value;
      });
    },
    { expected: popupDefaults }
  );
  await popupPage.waitForTimeout(150);

  const popupSnapshots = [];
  for (const tabId of tabIds) {
    await popupPage.click(`#${tabId}`);
    await popupPage.waitForFunction(
      (id) => document.getElementById(id)?.getAttribute("aria-selected") === "true",
      tabId
    );
    await popupPage.waitForTimeout(80);
    popupSnapshots.push(await popupPage.locator("body").screenshot({ type: "png" }));
  }

  const reviewPage = await browser.newPage({
    viewport: { width: 1920, height: 3000 },
    colorScheme: "dark"
  });
  const gridRows = Math.ceil(tabIds.length / gridColumns);
  const imageDataUrls = popupSnapshots.map(
    (snapshot) => `data:image/png;base64,${snapshot.toString("base64")}`
  );

  await reviewPage.setContent(
    `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        background: #0f1115;
      }
      #grid {
        display: grid;
        grid-template-columns: repeat(${gridColumns}, max-content);
        gap: ${gridGapPx}px;
        padding: ${gridPaddingPx}px;
        width: max-content;
        background: #0f1115;
      }
      #grid img {
        display: block;
      }
    </style>
  </head>
  <body>
    <div id="grid"></div>
    <script>
      const data = ${JSON.stringify(imageDataUrls)};
      const grid = document.getElementById("grid");
      for (const src of data) {
        const img = new Image();
        img.src = src;
        grid.appendChild(img);
      }
    </script>
  </body>
</html>`,
    { waitUntil: "load" }
  );
  await reviewPage.waitForFunction(
    ({ expected }) =>
      document.images.length === expected &&
      Array.from(document.images).every((img) => img.complete),
    { expected: tabIds.length }
  );
  await reviewPage.waitForFunction(
    ({ expectedRows, expectedColumns, gapPx, paddingPx }) => {
      const grid = document.getElementById("grid");
      if (!grid || document.images.length === 0) return false;
      const firstImage = document.images[0];
      const expectedWidth =
        firstImage.naturalWidth * expectedColumns + gapPx * (expectedColumns - 1) + paddingPx * 2;
      const expectedHeight =
        firstImage.naturalHeight * expectedRows + gapPx * (expectedRows - 1) + paddingPx * 2;
      return (
        Math.abs(grid.clientWidth - expectedWidth) <= 1 &&
        Math.abs(grid.clientHeight - expectedHeight) <= 1
      );
    },
    {
      expectedRows: gridRows,
      expectedColumns: gridColumns,
      gapPx: gridGapPx,
      paddingPx: gridPaddingPx
    }
  );

  await reviewPage.locator("#grid").screenshot({ path: screenshotPath, type: "jpeg", quality: 90 });
  await reviewPage.close();
  await popupPage.close();

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
