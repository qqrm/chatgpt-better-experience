import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

/**
 * Build into dist-chrome/ or dist-firefox/ using platform-specific manifest templates.
 *
 * Usage:
 *   node scripts/build-target.mjs chrome
 *   node scripts/build-target.mjs firefox
 */

const target = process.argv[2];

if (target !== "chrome" && target !== "firefox") {
  console.error('Usage: node scripts/build-target.mjs <chrome|firefox>');
  process.exit(2);
}

const outDir = target === "chrome" ? "dist-chrome" : "dist-firefox";
const manifestTemplatePath = target === "chrome"
  ? "manifests/manifest.chrome.json"
  : "manifests/manifest.firefox.json";

const shared = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  sourcemap: true
};

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await Promise.all([
  build({
    ...shared,
    entryPoints: ["content.ts"],
    outfile: `${outDir}/content.js`
  }),
  build({
    ...shared,
    entryPoints: ["popup.ts"],
    outfile: `${outDir}/popup.js`
  }),
  build({
    ...shared,
    entryPoints: ["src/pageTranscribeHook.ts"],
    outfile: `${outDir}/pageTranscribeHook.js`
  })
]);

// popup.html in repo references dist/*; for MV3 build outputs we want plain relative paths.
const popupHtml = await readFile("popup.html", "utf8");
await writeFile(`${outDir}/popup.html`, popupHtml.replace(/dist\//g, ""));

// Use template manifest per target, but keep version/name/description in sync.
const [pkgRaw, manifestRaw] = await Promise.all([
  readFile("package.json", "utf8"),
  readFile(manifestTemplatePath, "utf8")
]);

const pkg = JSON.parse(pkgRaw);
const manifest = JSON.parse(manifestRaw);

if (typeof pkg.version === "string" && pkg.version.trim() !== "") {
  manifest.version = pkg.version;
}

// If you want to keep these in sync too, uncomment:
// if (typeof pkg.name === "string") manifest.name = manifest.name ?? pkg.name;

await writeFile(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2));

await cp("icons", `${outDir}/icons`, { recursive: true });
