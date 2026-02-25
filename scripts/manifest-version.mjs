import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function die(message) {
  console.error(message);
  process.exit(1);
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseSemver(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim());
  if (!m) die(`Unsupported version format: "${version}". Expected x.y.z`);
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3])
  };
}

function printUsage() {
  die(
    [
      "Usage:",
      "  node scripts/manifest-version.mjs print [path/to/manifest.json]",
      "  node scripts/manifest-version.mjs bump-patch [path/to/manifest.json]"
    ].join("\n")
  );
}

const [command, fileArg] = process.argv.slice(2);
if (!command) printUsage();

const filePath = path.resolve(process.cwd(), fileArg ?? "manifest.json");

if (!fs.existsSync(filePath)) {
  die(`File not found: ${filePath}`);
}

const json = readJson(filePath);
const currentVersion = json?.version;

if (typeof currentVersion !== "string" || currentVersion.trim() === "") {
  die(`Missing or invalid "version" field in ${filePath}`);
}

if (command === "print") {
  console.log(currentVersion.trim());
  process.exit(0);
}

if (command === "bump-patch") {
  const parsed = parseSemver(currentVersion);
  const nextVersion = `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  json.version = nextVersion;
  writeJson(filePath, json);
  console.log(nextVersion);
  process.exit(0);
}

printUsage();
