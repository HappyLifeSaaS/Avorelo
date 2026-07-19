// Avorelo Runtime Boundary (Slice 2). Mediates fs/secret access. Independent of any platform sandbox
// (the platform sandbox is NOT relied upon — S2). Deterministic. Owns the "runtime-boundary" concern.

import { resolve, sep } from "node:path";
import { detectSecretClasses } from "../../shared/redaction/index.ts";

// Files whose contents must never be read into model context (deny raw-secret reads).
const SECRET_READ_DENYLIST = [
  /(^|[\\/])\.ssh([\\/]|$)/i,
  /(^|[\\/])\.aws[\\/]credentials$/i,
  /(^|[\\/])id_rsa$/i,
  /\.pem$/i,
  /(^|[\\/])\.env(\.|$)/i,
];

function within(root: string, target: string): boolean {
  const r = resolve(root);
  const t = resolve(target);
  return t === r || t.startsWith(r + sep);
}

/** A path that must never be written (or read into model context) regardless of scope. */
function isSensitivePath(targetPath: string): boolean {
  return SECRET_READ_DENYLIST.some((re) => re.test(targetPath));
}

export type WriteCheck = { allowed: boolean; reasonCodes: string[] };

/**
 * Writes are confined deterministically (S2, fail-closed). Rules, in order:
 *  1) Obvious secret/sensitive paths (.env, .ssh, .aws/credentials, *.pem, id_rsa) are ALWAYS blocked,
 *     even inside the working dir — secrets are never a legitimate write target for the agent.
 *  2) Anything outside the working dir is ALWAYS blocked (path traversal resolves before the check).
 *  3) If allowedPaths is non-empty, the target must ALSO be inside one of them (narrowing within the
 *     working dir). An empty allowedPaths means "anywhere inside the working dir" (minus rule 1).
 */
export function checkWrite(targetPath: string, opts: { workingDir: string; allowedPaths?: string[] }): WriteCheck {
  if (isSensitivePath(targetPath)) return { allowed: false, reasonCodes: ["WRITE_TO_SENSITIVE_PATH_DENIED"] };
  if (!within(opts.workingDir, targetPath)) return { allowed: false, reasonCodes: ["WRITE_OUTSIDE_WORKING_DIR"] };
  const allowed = opts.allowedPaths ?? [];
  if (allowed.length > 0) {
    if (!allowed.some((a) => within(a, targetPath))) return { allowed: false, reasonCodes: ["WRITE_OUTSIDE_ALLOWED_PATHS"] };
    return { allowed: true, reasonCodes: ["WRITE_IN_ALLOWED_PATH"] };
  }
  return { allowed: true, reasonCodes: ["WRITE_IN_WORKING_DIR"] };
}

export type ReadCheck = { allowedForModel: boolean; reasonCodes: string[] };

/** Reads of secret-bearing files are denied to the model/cloud regardless of any platform sandbox. */
export function checkModelRead(targetPath: string): ReadCheck {
  for (const re of SECRET_READ_DENYLIST) {
    if (re.test(targetPath)) return { allowedForModel: false, reasonCodes: ["SECRET_FILE_READ_DENIED"] };
  }
  return { allowedForModel: true, reasonCodes: ["READ_OK"] };
}

/** Returns the derived secret CLASSES present in content (never the values). Used to deny raw-secret egress. */
export function secretClassesIn(content: unknown): string[] {
  return detectSecretClasses(content);
}

/** True if content carries a raw secret that must not reach LLM/cloud/logs. */
export function carriesRawSecret(content: unknown): boolean {
  return detectSecretClasses(content).some((c) => !c.startsWith("key:"));
}
