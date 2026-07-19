// Avorelo local preview server (Slice 5). Zero-dependency Node http server that serves a static directory at
// http://127.0.0.1:<port>/. LOCAL-ONLY by design: binds to 127.0.0.1 (never 0.0.0.0), serves only files inside
// the given root (path-traversal denied), no network egress, no trackers. Used to give a real reviewable URL.

import { createServer } from "node:http";
import type { Server } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, normalize, extname, sep } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

/** Resolve a request path to a file inside root, or null if it escapes root / does not exist (traversal denied).
 *  Supports clean-URL aliases: /dashboard -> /dashboard.html, /pricing -> /pricing.html */
export function resolveRequestPath(root: string, urlPath: string): string | null {
  let p = decodeURIComponent((urlPath.split("?")[0] || "/"));
  if (p.endsWith("/")) p += "index.html";
  const rootNorm = normalize(root);
  const tryResolve = (candidate: string): string | null => {
    const abs = normalize(join(rootNorm, candidate));
    if (abs !== rootNorm && !abs.startsWith(rootNorm.endsWith(sep) ? rootNorm : rootNorm + sep)) return null;
    try { if (!existsSync(abs) || !statSync(abs).isFile()) return null; } catch { return null; }
    return abs;
  };
  // Try exact path first, then .html alias for clean URLs (/dashboard -> /dashboard.html)
  return tryResolve(p) ?? (extname(p) === "" ? tryResolve(p + ".html") : null);
}

export type PreviewHandle = { url: string; port: number; close: () => Promise<void>; server: Server };

/** Start a local preview server for `root`. Resolves once listening with the URL. */
export function serve(root: string, opts?: { port?: number; host?: string }): Promise<PreviewHandle> {
  const host = opts?.host ?? "127.0.0.1";
  const server = createServer((req, res) => {
    const file = resolveRequestPath(root, req.url ?? "/");
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
      return;
    }
    try {
      const body = readFileSync(file);
      res.writeHead(200, {
        "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      res.end(body);
    } catch {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("500");
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts?.port ?? 0, host, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : opts?.port ?? 0;
      resolve({
        url: `http://${host}:${port}/`,
        port,
        server,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
