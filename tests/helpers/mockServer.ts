import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

export type MockServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

const toFilePath = (rootDir: string, reqUrl: string) => {
  const url = new URL(reqUrl, "http://127.0.0.1");
  const pathname = decodeURIComponent(url.pathname);
  const safePath = pathname.replace(/^\/+/, "");
  const resolved = path.join(rootDir, safePath);
  if (!resolved.startsWith(rootDir)) return null;
  return resolved;
};

const send = async (res: ServerResponse, filePath: string) => {
  const ext = path.extname(filePath).toLowerCase();
  const type = contentTypes[ext] ?? "application/octet-stream";
  const data = await readFile(filePath);
  res.writeHead(200, { "Content-Type": type });
  res.end(data);
};

export async function startMockServer(rootDir: string): Promise<MockServer> {
  const handleRequest = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!req.url) {
        res.writeHead(400);
        res.end("Bad request");
        return;
      }
      const filePath = toFilePath(rootDir, req.url);
      if (!filePath) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      await send(res, filePath);
    } catch (_error) {
      res.writeHead(404);
      res.end("Not found");
    }
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start mock server");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      })
  };
}
