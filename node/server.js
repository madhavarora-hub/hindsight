// Tiny HTTP server: the web UI plus a JSON API over the engine.
// Binds to 127.0.0.1 unless HOST is set.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { ROOT, loadEnv, makeEngine } from "./setup.js";
import { runBots, BOTS } from "../core/bots.js";

loadEnv();
const engine = await makeEngine();
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };

// Writes are serialised so two clicks can't race on the same open forecast.
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn));

const routes = {
  "GET /api/info": async () => ({ store: engine.store.name, mainnet: Boolean(engine.store.mainnet), source: engine.sui.name, bots: BOTS }),
  "GET /api/state": async () => engine.state(),
  "GET /api/snapshot": async (q) => engine.snapshot({ address: q.get("address") || undefined }),
  "POST /api/coach": async (_, body) => engine.coach(body),
  "POST /api/forecast": (_, body) => serial(() => engine.forecast(body, { acceptSuggestion: Boolean(body.acceptSuggestion) })),
  "POST /api/resolve": () => serial(() => engine.resolveDue()),
  "POST /api/bots": (_, body) => serial(() => runBots(engine, { windowMin: Number(body.windowMin) || 3 })),
  "POST /api/reload": () => serial(async () => (await engine.load(), engine.state())),
};

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 32_000) throw new Error("body too large");
  }
  return raw ? JSON.parse(raw) : {};
}

async function serveStatic(path, res) {
  const rel = normalize(path.endsWith("/") ? `${path}index.html` : path).replace(/^([/\\])+/, "");
  // Only the UI and the browser-safe core are public; never .env or data/.
  const allowed = rel === "index.html" || /^(web|core)[/\\][\w.-]+$/.test(rel);
  if (!allowed) return send(res, 404, "not found", "text/plain");
  try {
    const data = await readFile(join(ROOT, rel));
    send(res, 200, data, TYPES[extname(rel)] ?? "application/octet-stream");
  } catch {
    send(res, 404, "not found", "text/plain");
  }
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  // The UI lives under /web/ and calls api/... relatively, so accept any prefix.
  const path = url.pathname.replace(/^.*?\/api\//, "/api/");
  const route = routes[`${req.method} ${path}`];
  if (!route) return serveStatic(url.pathname, res);
  try {
    const body = req.method === "POST" ? await readBody(req) : {};
    send(res, 200, await route(url.searchParams, body));
  } catch (e) {
    send(res, 400, { error: String(e.message ?? e) });
  }
}).listen(PORT, HOST, () => {
  console.log(`Hindsight on http://${HOST}:${PORT}  memory=${engine.store.name}  chain=${engine.sui.name}  memories=${engine.log.length}`);
});
