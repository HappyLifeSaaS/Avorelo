// Avorelo Secret Protection capability (Slice 2, live-boundary). Detection only — owns no policy/receipt.
// Calls shared/redaction; returns derived CLASSES (never values). The Kernel (policy/gate) decides.

import { detectSecretClasses } from "../../shared/redaction/index.ts";

export type SecretScan = { hasSecret: boolean; classes: string[] };

/** Scan candidate content at the live boundary (prompt/context/tool input/output). Classes only. */
export function scanLiveBoundary(content: unknown): SecretScan {
  const classes = detectSecretClasses(content);
  // "key:..." entries are redact-by-key-name (e.g. a `prompt` field), not necessarily a literal secret value.
  const hasSecretValue = classes.some((c) => !c.startsWith("key:"));
  return { hasSecret: hasSecretValue || classes.length > 0, classes };
}
