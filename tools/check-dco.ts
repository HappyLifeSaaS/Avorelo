// Avorelo DCO 1.1 sign-off checker.
//
// Verifies that every non-merge commit introduced by a pull request carries a valid
//   Signed-off-by: Name <email>
// trailer, certifying the Developer Certificate of Origin 1.1 (see the DCO file).
//
// Pure validators are exported for deterministic tests. When run, it reads commits from a git range
// (arg or DCO_RANGE env) and reports failing commit SHA, reason, and the remediation command.
//
// Safety: read-only. It never executes commit content; it only parses commit metadata.
//
// Usage: node tools/check-dco.ts [<range>]     e.g. node tools/check-dco.ts origin/main..HEAD

import { execFileSync } from "node:child_process";

export type CommitRecord = { sha: string; parents: string[]; body: string };
export type DcoResult = { sha: string; ok: boolean; reason?: string };

// A commit with 2+ parents is a merge commit and is exempt.
export function isMerge(c: CommitRecord): boolean {
  return c.parents.length >= 2;
}

// A valid trailer: "Signed-off-by: <name> <<email>>" with a non-empty name and an email-shaped address.
// Names may contain Unicode. Emails include GitHub noreply (id+login@users.noreply.github.com).
const SIGNOFF_RE = /^\s*Signed-off-by:\s*(.+?)\s*<([^<>]+)>\s*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function extractSignoffs(body: string): Array<{ name: string; email: string }> {
  const out: Array<{ name: string; email: string }> = [];
  for (const raw of body.split(/\r?\n/)) {
    const m = raw.match(SIGNOFF_RE);
    if (m) out.push({ name: m[1].trim(), email: m[2].trim() });
  }
  return out;
}

/** True if the commit body contains at least one well-formed sign-off. */
export function hasValidSignoff(body: string): boolean {
  for (const s of extractSignoffs(body)) {
    if (s.name.length > 0 && EMAIL_RE.test(s.email)) return true;
  }
  return false;
}

export function checkCommits(commits: CommitRecord[]): DcoResult[] {
  return commits.map((c) => {
    if (isMerge(c)) return { sha: c.sha, ok: true };
    const signoffs = extractSignoffs(c.body);
    if (signoffs.length === 0) {
      return { sha: c.sha, ok: false, reason: "no Signed-off-by trailer" };
    }
    if (!hasValidSignoff(c.body)) {
      const bad = signoffs[0];
      const why = bad.name.length === 0 ? "empty name in sign-off"
        : !EMAIL_RE.test(bad.email) ? `malformed email in sign-off: <${bad.email}>`
        : "malformed sign-off";
      return { sha: c.sha, ok: false, reason: why };
    }
    return { sha: c.sha, ok: true };
  });
}

// ---- git gathering (only when run as a script) ----

function gitCommits(range: string): CommitRecord[] {
  // %x00-delimited record: sha, parents, raw body. %x1e separates commits.
  const fmt = "%H%x00%P%x00%B%x1e";
  const out = execFileSync("git", ["log", `--format=${fmt}`, range], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const records: CommitRecord[] = [];
  for (const chunk of out.split("\x1e")) {
    const t = chunk.replace(/^\s+/, "");
    if (!t) continue;
    const [sha, parents, ...bodyParts] = t.split("\x00");
    if (!sha) continue;
    records.push({ sha: sha.trim(), parents: parents.trim() ? parents.trim().split(/\s+/) : [], body: bodyParts.join("\x00") });
  }
  return records;
}

const invokedDirectly = process.argv[1] && /check-dco\.ts$/.test(process.argv[1]);
if (invokedDirectly) {
  const range = process.argv[2] || process.env.DCO_RANGE || "HEAD~1..HEAD";
  let commits: CommitRecord[] = [];
  try {
    commits = gitCommits(range);
  } catch (e) {
    process.stderr.write(`[dco] could not read git range "${range}": ${(e as Error).message}\n`);
    process.exit(2);
  }
  const results = checkCommits(commits);
  const failures = results.filter((r) => !r.ok);
  const nonMerge = commits.filter((c) => !isMerge(c)).length;
  process.stdout.write(`[dco] range ${range}: ${commits.length} commit(s), ${nonMerge} non-merge, ${failures.length} without valid sign-off\n`);
  for (const f of failures) {
    process.stderr.write(`FAIL  ${f.sha.slice(0, 12)}  ${f.reason}\n`);
  }
  if (failures.length > 0) {
    process.stderr.write(
      "\nDCO_FAILED — every commit needs a Signed-off-by trailer.\n" +
      "  Fix the latest commit:   git commit --amend --signoff\n" +
      "  Fix a branch of commits: git rebase --signoff <base>   (then force-push your topic branch)\n" +
      "  See docs/contributing/dco-guide.md\n");
    process.exit(1);
  }
  process.stdout.write("DCO_OK — all contributed commits are signed off.\n");
}
