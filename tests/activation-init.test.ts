// Activation / local first-run v1 (avorelo.activation.v1) — local, zero-dep, node:test.
// Verifies `init` initializes a local workspace safely and idempotently with no network / cloud / auth,
// detects git/package safely, handles edge folders honestly, and never writes raw source/env/secrets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  initWorkspace, buildActivationContract, loadWorkspace, loadActivationContract,
  validateActivationContract, ACTIVATION_V1_CONTRACT,
} from "../src/avorelo/capabilities/activation/init.ts";

const sandbox = (suffix = "") => mkdtempSync(join(tmpdir(), `avorelo-init-${suffix}`));
const cleanup = (d: string) => { if (existsSync(d) && d.includes("avorelo-init-")) rmSync(d, { recursive: true, force: true }); };
const gitRepo = () => { const d = sandbox("git-"); try { execSync("git init -q", { cwd: d, stdio: "pipe" }); } catch {} writeFileSync(join(d, "package.json"), '{"name":"demo","scripts":{"test":"echo ok"}}'); return d; };

test("activation contract exists and is well-formed", () => {
  const d = sandbox();
  try {
    const c = buildActivationContract(d, { now: 1760000000000 });
    assert.equal(c.contract, ACTIVATION_V1_CONTRACT);
    assert.equal(c.schemaVersion, 1);
    assert.equal(c.localOnly, true);
    assert.equal(c.cloudClaimed, false);
    assert.ok(c.commandsAvailable.run && c.commandsAvailable.controlCenter && c.commandsAvailable.readiness);
    assert.ok(c.firstRunRecommended.command && c.firstRunRecommended.reason);
    assert.equal(validateActivationContract(c).valid, true);
  } finally { cleanup(d); }
});

test("init creates a local activation artifact (workspace.json + activation.json)", () => {
  const d = sandbox();
  try {
    const r = initWorkspace(d, { now: 1760000000000 });
    assert.equal(r.ok, true);
    assert.equal(r.created, true);
    assert.ok(existsSync(join(d, ".avorelo", "workspace.json")));
    assert.ok(existsSync(join(d, ".avorelo", "activation.json")));
    const loaded = loadActivationContract(d);
    assert.equal(loaded?.contract, ACTIVATION_V1_CONTRACT);
    assert.equal(loaded?.initialized, true);
    assert.equal(loaded?.avoreloDirReady, true);
  } finally { cleanup(d); }
});

test("init is idempotent: workspaceId and createdAt preserved across runs", () => {
  const d = sandbox();
  try {
    const r1 = initWorkspace(d, { now: 1760000000000 });
    const r2 = initWorkspace(d, { now: 1760009999999 });
    assert.equal(r2.created, false);
    assert.equal(r1.contract!.workspaceId, r2.contract!.workspaceId);
    assert.equal(loadWorkspace(d)!.createdAt, r1.contract!.createdAt);
  } finally { cleanup(d); }
});

test("init --reset issues a new workspaceId", () => {
  const d = sandbox();
  try {
    const r1 = initWorkspace(d, { now: 1760000000000 });
    const r2 = initWorkspace(d, { now: 1760000000001, reset: true });
    assert.notEqual(r1.contract!.workspaceId, r2.contract!.workspaceId);
  } finally { cleanup(d); }
});

test("init requires no network and no cloud credentials (pure local, cloud not claimed/available)", () => {
  const d = sandbox();
  try {
    const r = initWorkspace(d, { now: 1760000000000 });
    assert.equal(r.contract!.cloudClaimed, false);
    assert.equal(r.contract!.cloudClaimAvailable, false);
    assert.equal(r.contract!.localOnly, true);
  } finally { cleanup(d); }
});

test("init does not read raw source contents (only safe metadata)", () => {
  const d = sandbox();
  try {
    // a source file with a secret-looking string must never end up in the activation artifact
    writeFileSync(join(d, "secrets.ts"), 'export const KEY = "ghp_ABCDEF" + "GHIJKLMNOPQRSTUVWXYZ0123456789";');
    writeFileSync(join(d, "package.json"), '{"name":"demo"}');
    initWorkspace(d, { now: 1760000000000 });
    const onDisk = readFileSync(join(d, ".avorelo", "activation.json"), "utf8");
    assert.ok(!onDisk.includes("ghp_ABCDEF" + "GHIJKLMNOPQRSTUVWXYZ0123456789"), "no source/secret in artifact");
    assert.ok(!onDisk.includes("export const KEY"), "no source line in artifact");
  } finally { cleanup(d); }
});

test("init detects a git repo safely", () => {
  const d = gitRepo();
  try {
    const r = initWorkspace(d, { now: 1760000000000 });
    assert.equal(r.contract!.gitDetected, true);
    assert.equal(r.contract!.packageDetected, true);
  } finally { cleanup(d); }
});

test("init handles a non-git folder", () => {
  const d = sandbox();
  try {
    writeFileSync(join(d, "package.json"), '{"name":"demo"}');
    const r = initWorkspace(d, { now: 1760000000000 });
    assert.equal(r.ok, true);
    assert.equal(r.contract!.gitDetected, false);
    assert.equal(r.contract!.packageDetected, true);
    assert.equal(r.contract!.repoDetected, true);
  } finally { cleanup(d); }
});

test("init handles a folder with no package.json", () => {
  const d = sandbox();
  try {
    const r = initWorkspace(d, { now: 1760000000000 });
    assert.equal(r.ok, true);
    assert.equal(r.contract!.packageDetected, false);
  } finally { cleanup(d); }
});

test("init handles an existing partial .avorelo (no workspace.json yet)", () => {
  const d = sandbox();
  try {
    mkdirSync(join(d, ".avorelo", "receipts"), { recursive: true });
    const r = initWorkspace(d, { now: 1760000000000 });
    assert.equal(r.ok, true);
    assert.equal(r.created, true, "treated as fresh init since no workspace.json existed");
    assert.ok(existsSync(join(d, ".avorelo", "workspace.json")));
  } finally { cleanup(d); }
});

test("init handles a stale/corrupt workspace.json by re-initializing", () => {
  const d = sandbox();
  try {
    mkdirSync(join(d, ".avorelo"), { recursive: true });
    writeFileSync(join(d, ".avorelo", "workspace.json"), "{ this is not json");
    const r = initWorkspace(d, { now: 1760000000000 });
    assert.equal(r.ok, true);
    assert.equal(r.created, true, "unparseable workspace is treated as fresh");
    assert.ok(loadWorkspace(d), "now well-formed");
  } finally { cleanup(d); }
});

test("init fails honestly on a missing target", () => {
  const d = sandbox();
  try {
    const r = initWorkspace(join(d, "does-not-exist"), { now: 1760000000000 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "target_does_not_exist");
    assert.equal(r.contract, undefined);
  } finally { cleanup(d); }
});

test("init fails honestly when target is a file, not a directory", () => {
  const d = sandbox();
  try {
    const f = join(d, "afile.txt");
    writeFileSync(f, "x");
    const r = initWorkspace(f, { now: 1760000000000 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "target_not_a_directory");
  } finally { cleanup(d); }
});

test("status (buildActivationContract) reports uninitialized vs initialized + suggests next command", () => {
  const d = sandbox();
  try {
    const before = buildActivationContract(d, { now: 1760000000000 });
    assert.equal(before.initialized, false);
    assert.match(before.firstRunRecommended.command, /avorelo init/);
    initWorkspace(d, { now: 1760000000000 });
    const after = buildActivationContract(d, { now: 1760000000000 });
    assert.equal(after.initialized, true);
    assert.match(after.firstRunRecommended.command, /avorelo run/);
  } finally { cleanup(d); }
});

test("activation artifact carries no raw secret/source/env/log/diff", () => {
  const d = sandbox();
  try {
    initWorkspace(d, { now: 1760000000000 });
    const c = loadActivationContract(d)!;
    const s = JSON.stringify(c);
    assert.equal(c.safety.containsRawSecret, false);
    assert.equal(c.safety.containsRawSource, false);
    assert.equal(c.safety.containsEnvValue, false);
    assert.ok(!/AKIA|ghp_|-----BEGIN|password=|DATABASE_URL=/.test(s), "no secret-shaped content");
  } finally { cleanup(d); }
});

test("first-run flow: init then run creates a runtime session, surfaced by the control center", async () => {
  const d = gitRepo();
  try {
    initWorkspace(d, { now: 1760000000000 });
    const { runRuntimeSession } = await import("../src/avorelo/capabilities/runtime-flow/index.ts");
    const { buildControlCenter } = await import("../src/avorelo/capabilities/control-center/index.ts");
    const rt = runRuntimeSession({ task: "run tests", dir: d, createdAt: "2026-06-11T00:00:00.000Z", now: 1760000000000 });
    assert.equal(rt.gate, "allow");
    const cc = buildControlCenter(d, { now: 1760000000000 });
    assert.equal(cc.sections.runtimeSession.status, "available");
  } finally { cleanup(d); }
});
