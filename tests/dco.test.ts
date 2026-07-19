// Avorelo DCO checker tests (node:test, zero-dep, no network, no git access).
// Adversarial coverage of the sign-off validator.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCommits, hasValidSignoff, extractSignoffs, isMerge, type CommitRecord } from "../tools/check-dco.ts";

const c = (sha: string, body: string, parents: string[] = ["p1"]): CommitRecord => ({ sha, parents, body });

test("a single signed-off commit passes", () => {
  const r = checkCommits([c("a1", "fix: thing\n\nSigned-off-by: Jane Doe <jane@example.com>")]);
  assert.deepEqual(r, [{ sha: "a1", ok: true }]);
});

test("multiple commits, all signed off, pass", () => {
  const r = checkCommits([
    c("a1", "x\n\nSigned-off-by: A B <a@b.io>"),
    c("a2", "y\n\nSigned-off-by: C D <c@d.io>"),
  ]);
  assert.ok(r.every((x) => x.ok));
});

test("one unsigned commit among signed commits fails only that one", () => {
  const r = checkCommits([
    c("a1", "x\n\nSigned-off-by: A B <a@b.io>"),
    c("a2", "y (no signoff)"),
    c("a3", "z\n\nSigned-off-by: C D <c@d.io>"),
  ]);
  assert.equal(r.find((x) => x.sha === "a2")!.ok, false);
  assert.equal(r.filter((x) => !x.ok).length, 1);
});

test("multiple sign-offs are accepted", () => {
  assert.ok(hasValidSignoff("m\n\nSigned-off-by: A B <a@b.io>\nSigned-off-by: C D <c@d.io>"));
});

test("merge commits are exempt", () => {
  const merge = c("m1", "Merge branch 'x'", ["p1", "p2"]);
  assert.ok(isMerge(merge));
  assert.deepEqual(checkCommits([merge]), [{ sha: "m1", ok: true }]);
});

test("CRLF line endings are handled", () => {
  assert.ok(hasValidSignoff("subject\r\n\r\nSigned-off-by: Jane Doe <jane@example.com>\r\n"));
});

test("Unicode names are accepted", () => {
  assert.ok(hasValidSignoff("m\n\nSigned-off-by: Renée Ó Súilleabháin <r@x.io>"));
});

test("GitHub noreply addresses are accepted", () => {
  assert.ok(hasValidSignoff("m\n\nSigned-off-by: Benjamin Persky <154359735+HappyLifeSaaS@users.noreply.github.com>"));
});

test("adversarial: missing trailer fails", () => {
  assert.equal(checkCommits([c("a", "just a subject")])[0].ok, false);
});

test("adversarial: empty name fails", () => {
  const r = checkCommits([c("a", "m\n\nSigned-off-by:  <a@b.io>")]);
  assert.equal(r[0].ok, false);
  assert.match(r[0].reason!, /name/);
});

test("adversarial: malformed email fails", () => {
  for (const bad of ["notanemail", "a@b", "a@ b.io", "@b.io", "a@b."]) {
    const r = checkCommits([c("a", `m\n\nSigned-off-by: Name <${bad}>`)]);
    assert.equal(r[0].ok, false, `expected fail for <${bad}>`);
  }
});

test("adversarial: empty sign-off value fails", () => {
  assert.equal(checkCommits([c("a", "m\n\nSigned-off-by:")])[0].ok, false);
});

test("adversarial: sign-off-like prose without angle brackets fails", () => {
  assert.equal(checkCommits([c("a", "m\n\nSigned-off-by: Jane Doe jane at example dot com")])[0].ok, false);
});

test("the sign-off identity need not match any GitHub login (no such requirement)", () => {
  // Two different identities both validate — the checker only validates form, not identity ownership.
  assert.ok(hasValidSignoff("m\n\nSigned-off-by: Someone Else <other@person.dev>"));
  assert.equal(extractSignoffs("m\n\nSigned-off-by: X Y <x@y.io>").length, 1);
});
