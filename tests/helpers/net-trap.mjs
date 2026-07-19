// Network denial trap (preloaded via --import). Records ANY outbound attempt to NET_TRAP_LOG
// BEFORE throwing, so attempts are detected even when production code swallows the error in a catch.
// Loaded before the target module graph, so import-time/module-initialization attempts are caught too.
// Covers: global fetch, undici, node:http/https, net.connect, tls.connect, server listen/createServer
// (record-only), and child_process (spawn/spawnSync/exec/execFile/fork) — throwing when the child is a
// network-capable tool (curl/wget/PowerShell web/npm-install/npx or an http(s) URL argument).
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import child_process from "node:child_process";

const LOG = process.env.NET_TRAP_LOG;
function record(where, target) {
  try { if (LOG) fs.appendFileSync(LOG, `${where} ${target}\n`); } catch {}
}

// A spawned child is a network egress vector when it is a web fetcher, a package
// install/exec (registry fetch), or is handed an http(s) URL. Plain git / local
// `npm test` / node are NOT egress and must not false-positive normal operations.
function isNetworkChildCommand(cmd, args) {
  const c = String(cmd ?? "").toLowerCase();
  const line = [c, ...(Array.isArray(args) ? args.map(String) : [])].join(" ").toLowerCase();
  if (/\bhttps?:\/\//.test(line)) return true;
  if (/(^|[\\/])(curl|wget)(\.exe)?($|[\s"'])/.test(c)) return true;
  if (/(^|[\\/])(pwsh|powershell)(\.exe)?($|[\s"'])/.test(c) && /(invoke-webrequest|invoke-restmethod|\biwr\b|\birm\b|start-bitstransfer|net\.webclient|downloadstring|downloadfile)/.test(line)) return true;
  if (/(^|[\\/])(npm|npx|pnpm|yarn|bun)(\.cmd|\.exe)?($|[\s"'])/.test(c) && /\b(install|add|ci|exec|dlx|create|i)\b/.test(line)) return true;
  if (/(^|[\\/])npx(\.cmd|\.exe)?($|[\s"'])/.test(c)) return true;
  return false;
}

const g = globalThis;
if (typeof g.fetch === "function") {
  g.fetch = (...a) => { record("fetch", String(a[0])); throw new Error("NET_TRAP: fetch blocked"); };
}
// undici (Node's fetch/request implementation) — block direct use if the module is present.
try {
  const undici = await import("undici");
  for (const name of ["fetch", "request", "stream", "pipeline", "connect", "upgrade"]) {
    if (typeof undici[name] === "function") {
      undici[name] = (...a) => { record(`undici.${name}`, String(a[0]?.href ?? a[0])); throw new Error("NET_TRAP: undici blocked"); };
    }
  }
} catch { /* undici not installed — global fetch patch above still covers it */ }
for (const [mod, name] of [[http, "http"], [https, "https"]]) {
  mod.request = (...a) => { record(`${name}.request`, String(a[0]?.href ?? a[0])); throw new Error("NET_TRAP blocked"); };
  mod.get = (...a) => { record(`${name}.get`, String(a[0]?.href ?? a[0])); throw new Error("NET_TRAP blocked"); };
}
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...a) {
  const t = typeof a[0] === "object" ? JSON.stringify(a[0]) : String(a[0]);
  // Allow loopback (local inbound servers/tests bind to 127.0.0.1); block anything else.
  if (/127\.0\.0\.1|::1|localhost/.test(t)) return origConnect.apply(this, a);
  record("net.connect", t); throw new Error("NET_TRAP blocked");
};
// Server-start detection (record-only, never throws — so a legitimate local `serve` preview still works).
// Lets import/startup-safety tests assert that an inert command starts no server / binds no port.
for (const [mod, name] of [[http, "http"], [https, "https"]]) {
  const origCreate = mod.createServer;
  mod.createServer = (...a) => { record(`${name}.createServer`, ""); return origCreate.apply(mod, a); };
}
const origListen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...a) { record("net.listen", String(a[0])); return origListen.apply(this, a); };

const origTls = tls.connect;
tls.connect = (...a) => {
  const t = typeof a[0] === "object" ? JSON.stringify(a[0]) : String(a[0]);
  if (/127\.0\.0\.1|::1|localhost/.test(t)) return origTls.apply(tls, a);
  record("tls.connect", t); throw new Error("NET_TRAP blocked");
};

// child_process: inspect every spawn; record + block ONLY network-capable children (egress
// vectors). A benign local git / node / `npm test` spawn passes through silently, so it does
// not count as an outbound attempt. Optionally, every spawn is mirrored to NET_TRAP_CHILD_LOG
// for tests that want to assert on all child-process activity.
const CHILD_LOG = process.env.NET_TRAP_CHILD_LOG;
for (const name of ["spawn", "spawnSync", "exec", "execFile", "execFileSync", "execSync", "fork"]) {
  const orig = child_process[name];
  if (typeof orig !== "function") continue;
  child_process[name] = function (...a) {
    const cmd = a[0];
    // exec/execSync take a full command string as arg 0; spawn/execFile take (cmd, args[]).
    const isExecString = /exec(Sync)?$/.test(name);
    const parts = String(cmd).split(/\s+/);
    const isNet = isExecString
      ? isNetworkChildCommand(parts[0], parts.slice(1))
      : isNetworkChildCommand(cmd, Array.isArray(a[1]) ? a[1] : []);
    try { if (CHILD_LOG) fs.appendFileSync(CHILD_LOG, `child:${name} ${String(cmd)}\n`); } catch {}
    if (isNet) { record(`child.network:${name}`, String(cmd)); throw new Error("NET_TRAP: network child process blocked"); }
    return orig.apply(child_process, a);
  };
}
