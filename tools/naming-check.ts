// Avorelo naming invariant check (dev tooling, per doc 128). Lives in tools/ (NOT src/avorelo) because it
// must reference the legacy tokens to detect them — product runtime stays Avorelo-only.
// FAILS (exit 1) if any runtime file under src/avorelo/** contains legacy tokens wuz|cco|claudecode-optimizer.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "src", "avorelo");
const LEGACY = /\b(wuz|cco|claudecode-optimizer)\b/i;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|js|mts|cts|json)$/.test(name)) out.push(p);
  }
  return out;
}

const offenders: { file: string; line: number; text: string }[] = [];
for (const file of walk(ROOT)) {
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .forEach((text, i) => {
      if (LEGACY.test(text)) offenders.push({ file: file.replace(process.cwd(), "."), line: i + 1, text: text.trim().slice(0, 120) });
    });
}

if (offenders.length > 0) {
  process.stderr.write("NAMING_INVARIANT_FAILED — legacy tokens in src/avorelo runtime code:\n");
  for (const o of offenders) process.stderr.write(`  ${o.file}:${o.line}  ${o.text}\n`);
  process.exit(1);
}
process.stdout.write("NAMING_INVARIANT_OK — no legacy product naming in src/avorelo runtime code.\n");
