import { createServer } from "node:http";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const fixtureDir = path.join(repoRoot, "tests", "fixtures");
const mockDir = path.join(repoRoot, "mock-gpt");

const host = process.env.CBE_MOCK_GPT_HOST || "127.0.0.1";
const port = Number(process.env.CBE_MOCK_GPT_PORT || "4173");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8"
};

function respond(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store"
  });
  res.end(body);
}

function fixtureRouteFor(name) {
  const base = name.replace(/\.html$/i, "");
  if (/codex/i.test(base)) return "/codex";
  if (/home/i.test(base)) return "/";
  return `/c/${base}`;
}

async function listFixtures() {
  const entries = await readdir(fixtureDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => ({
      id: entry.name,
      label: entry.name
        .replace(/\.html$/i, "")
        .replace(/^chatgpt-fixture-/, "")
        .replace(/[-_]+/g, " "),
      route: fixtureRouteFor(entry.name)
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function isSafeFixtureName(value) {
  return /^[a-zA-Z0-9._-]+\.html$/.test(value);
}

async function tryServeFile(res, filePath) {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return false;
    const ext = path.extname(filePath).toLowerCase();
    const body = await readFile(filePath);
    respond(res, 200, body, MIME_TYPES[ext] || "application/octet-stream");
    return true;
  } catch {
    return false;
  }
}

function resolveStaticPath(urlPath) {
  const cleanPath = path.posix.normalize(urlPath).replace(/^(\.\.\/)+/, "");
  const relPath = cleanPath.replace(/^\/+/, "");
  if (relPath.startsWith("dist/")) return path.join(repoRoot, relPath);
  if (relPath.startsWith("mock-gpt/")) return path.join(repoRoot, relPath);
  return null;
}

const server = createServer(async (req, res) => {
  const method = req.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    respond(res, 405, "Method Not Allowed");
    return;
  }

  const url = new URL(req.url || "/", `http://${host}:${port}`);
  const pathname = url.pathname;

  if (pathname === "/__mock-gpt/catalog.json") {
    const fixtures = await listFixtures();
    respond(
      res,
      200,
      JSON.stringify(
        {
          fixtures,
          defaultFixtureId: fixtures[0]?.id ?? null
        },
        null,
        2
      ),
      MIME_TYPES[".json"]
    );
    return;
  }

  if (pathname.startsWith("/__mock-gpt/fixture/")) {
    const fixtureName = decodeURIComponent(pathname.slice("/__mock-gpt/fixture/".length));
    if (!isSafeFixtureName(fixtureName)) {
      respond(res, 400, "Invalid fixture name");
      return;
    }
    const fixturePath = path.join(fixtureDir, fixtureName);
    if (!(await tryServeFile(res, fixturePath))) {
      respond(res, 404, "Fixture not found");
    }
    return;
  }

  const staticPath = resolveStaticPath(pathname);
  if (staticPath && (await tryServeFile(res, staticPath))) return;

  const indexPath = path.join(mockDir, "index.html");
  if (!(await tryServeFile(res, indexPath))) {
    respond(res, 500, "mock-gpt/index.html not found");
  }
});

server.listen(port, host, () => {
  const rootUrl = `http://${host}:${port}`;
  console.log(`Mock GPT server running at ${rootUrl}`);
  console.log(`Open ${rootUrl}/c/mock-chat?fixture=chatgpt-fixture-2026-02-04-17-23-37.html`);
});
