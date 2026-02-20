import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const distDir = "dist";

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
    entryPoints: ["content.ts"],
    outfile: `${distDir}/content.js`
  }),
  build({
    ...shared,
    entryPoints: ["popup.ts"],
    outfile: `${distDir}/popup.js`
  })
]);

const popupHtml = await readFile("popup.html", "utf8");
await writeFile(`${distDir}/popup.html`, popupHtml.replace(/dist\//g, ""));

const manifestRaw = await readFile("manifest.json", "utf8");
const manifest = JSON.parse(manifestRaw);

if (Array.isArray(manifest.content_scripts)) {
  manifest.content_scripts = manifest.content_scripts.map((script) => ({
    ...script,
    js: Array.isArray(script.js) ? script.js.map(stripDistPrefix) : script.js
  }));
}

if (manifest.action?.default_popup) {
  manifest.action.default_popup = stripDistPrefix(manifest.action.default_popup);
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
