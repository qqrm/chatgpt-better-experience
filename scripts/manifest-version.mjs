import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function die(message) {
  console.error(message);
  process.exit(1);
}

function readRaw(filePath) {
  return fs.readFileSync(filePath, "utf8");
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

function bumpPatchString(version) {
  const parsed = parseSemver(version);
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

function replaceVersionInRaw(raw, expectedOld, nextVersion) {
  const re = /("version"\s*:\s*")(\d+\.\d+\.\d+)(")/g;
  let count = 0;
  let seenOld = null;
  const updated = raw.replace(re, (match, p1, oldV, p3) => {
    count += 1;
    seenOld = oldV;
    return `${p1}${nextVersion}${p3}`;
  });

  if (count !== 1) {
    die(`Expected exactly 1 "version" field match, found ${count}.`);
  }
  if (seenOld !== String(expectedOld).trim()) {
    die(`Version in text ("${seenOld}") does not match parsed JSON version ("${expectedOld}").`);
  }
  return updated;
}

function printUsage() {
  die(
    [
      "Usage:",
      "  node scripts/manifest-version.mjs print [path/to/manifest.base.json]",
      "  node scripts/manifest-version.mjs bump-patch [path/to/manifest.base.json]"
    ].join("\n")
  );
}

const [command, fileArg] = process.argv.slice(2);
if (!command) printUsage();

const filePath = path.resolve(process.cwd(), fileArg ?? "config/extension/manifest.base.json");

let raw;
try {
  raw = readRaw(filePath);
} catch {
  die(`File not found or unreadable: ${filePath}`);
}

let json;
try {
  json = JSON.parse(raw);
} catch {
  die(`Invalid JSON in ${filePath}`);
}

const currentVersion = json?.version;

if (typeof currentVersion !== "string" || currentVersion.trim() === "") {
  die(`Missing or invalid "version" field in ${filePath}`);
}

if (command === "print") {
  console.log(currentVersion.trim());
  process.exit(0);
}

if (command === "bump-patch") {
  const nextVersion = bumpPatchString(currentVersion);
  const updatedRaw = replaceVersionInRaw(raw, currentVersion, nextVersion);
  fs.writeFileSync(filePath, updatedRaw, "utf8");
  console.log(nextVersion);
  process.exit(0);
}

printUsage();
