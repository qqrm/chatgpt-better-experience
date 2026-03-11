import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const distDir = "dist";
const contentEntry = "src/entrypoints/content.ts";
const popupEntry = "src/popup/popup.ts";
const backgroundEntry = "src/background.ts";
const popupHtmlPath = "src/popup/popup.html";
const manifestPath = "config/extension/manifest.base.json";

const shared = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  sourcemap: true
};

const stripDistPrefix = (value) => value.replace(/^dist\//, "");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await Promise.all([
  build({
    ...shared,
    entryPoints: [contentEntry],
    outfile: `${distDir}/content.js`
  }),
  build({
    ...shared,
    entryPoints: [popupEntry],
    outfile: `${distDir}/popup.js`
  }),
  build({
    ...shared,
    entryPoints: [backgroundEntry],
    outfile: `${distDir}/background.js`
  })
]);

const popupHtml = await readFile(popupHtmlPath, "utf8");
await writeFile(`${distDir}/popup.html`, popupHtml.replace(/dist\//g, ""));

const manifestRaw = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(manifestRaw);

if (Array.isArray(manifest.content_scripts)) {
  manifest.content_scripts = manifest.content_scripts.map((script) => ({
    ...script,
    js: Array.isArray(script.js) ? script.js.map(stripDistPrefix) : script.js
  }));
}

if (Array.isArray(manifest.web_accessible_resources)) {
  manifest.web_accessible_resources = manifest.web_accessible_resources.map((entry) => ({
    ...entry,
    resources: Array.isArray(entry.resources)
      ? entry.resources.map(stripDistPrefix)
      : entry.resources
  }));
}

if (manifest.action?.default_popup) {
  manifest.action.default_popup = stripDistPrefix(manifest.action.default_popup);
}

if (manifest.background?.service_worker) {
  manifest.background.service_worker = stripDistPrefix(manifest.background.service_worker);
}

if (Array.isArray(manifest.background?.scripts)) {
  manifest.background.scripts = manifest.background.scripts.map(stripDistPrefix);
}

if (manifest.action?.default_icon) {
  manifest.action.default_icon = Object.fromEntries(
    Object.entries(manifest.action.default_icon).map(([size, path]) => [
      size,
      stripDistPrefix(path)
    ])
  );
}

if (manifest.icons) {
  manifest.icons = Object.fromEntries(
    Object.entries(manifest.icons).map(([size, path]) => [size, stripDistPrefix(path)])
  );
}

await writeFile(`${distDir}/manifest.json`, JSON.stringify(manifest, null, 2));

await cp("icons", `${distDir}/icons`, { recursive: true });
