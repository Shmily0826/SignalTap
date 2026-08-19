// Tiny static file server for the e2e fixtures (Playwright webServer).
import { createServer } from "http";
import { readFile } from "fs/promises";
import { extname, join, normalize } from "path";
import { fileURLToPath } from "url";

const root = fileURLToPath(new URL("../fixtures", import.meta.url));
const port = Number(process.env.PORT ?? 8099);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
};

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (urlPath === "/") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, fixtures: "signalTap e2e fixtures" }));
      return;
    }
    const rel = urlPath.replace(/^\/+/, "");
    const file = normalize(join(root, rel));
    if (!file.startsWith(root)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, () => console.log(`[e2e fixtures] http://localhost:${port}`));
