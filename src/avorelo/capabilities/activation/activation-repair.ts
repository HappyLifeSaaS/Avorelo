// Avorelo Activation Repair. Safe automatic fixes for local activation setup.
// Never overwrites user content. Never installs hooks by default. Never uses secrets.

import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export type RepairAction = {
  id: string;
  label: string;
  status: "applied" | "skipped" | "blocked" | "not_needed";
  path?: string;
  reason?: string;
};

export function runSafeRepairs(targetDir: string): RepairAction[] {
  const repairs: RepairAction[] = [];

  // 1. Ensure .avorelo directory structure
  const dirs = [
    ".avorelo",
    ".avorelo/activation",
    ".avorelo/receipts",
    ".avorelo/events",
    ".avorelo/internal",
    ".avorelo/dashboard",
    ".avorelo/run-entry",
    ".avorelo/site",
  ];
  for (const d of dirs) {
    const p = join(targetDir, d);
    if (!existsSync(p)) {
      try {
        mkdirSync(p, { recursive: true });
        repairs.push({ id: `create_dir_${d.replace(/[/.]/g, "_")}`, label: `Create ${d}`, status: "applied", path: p });
      } catch (e) {
        repairs.push({ id: `create_dir_${d.replace(/[/.]/g, "_")}`, label: `Create ${d}`, status: "blocked", path: p, reason: (e as Error).message });
      }
    } else {
      repairs.push({ id: `create_dir_${d.replace(/[/.]/g, "_")}`, label: `Create ${d}`, status: "not_needed", path: p });
    }
  }

  // 2. Ensure .gitignore has .avorelo block
  repairGitignore(targetDir, repairs);

  // 3. Ensure .avorelo/activation/activation-state.json contract record
  const contractPath = join(targetDir, ".avorelo", "run-entry", "activation-contract.json");
  if (!existsSync(contractPath)) {
    try {
      writeFileSync(contractPath, JSON.stringify({
        contract: "avorelo.activationContract.v1",
        createdAt: new Date().toISOString(),
        repoRoot: targetDir,
        mode: "local-first/free",
        redacted: true,
      }, null, 2));
      repairs.push({ id: "activation_contract", label: "Create activation contract", status: "applied", path: contractPath });
    } catch (e) {
      repairs.push({ id: "activation_contract", label: "Create activation contract", status: "blocked", reason: (e as Error).message });
    }
  } else {
    repairs.push({ id: "activation_contract", label: "Activation contract", status: "not_needed", path: contractPath });
  }

  return repairs;
}

const GITIGNORE_MARKER_START = "# >>> Avorelo (managed block — do not edit) >>>";
const GITIGNORE_MARKER_END = "# <<< Avorelo <<<";
const GITIGNORE_BLOCK = `${GITIGNORE_MARKER_START}
.avorelo/
${GITIGNORE_MARKER_END}`;

function repairGitignore(targetDir: string, repairs: RepairAction[]) {
  const gitignorePath = join(targetDir, ".gitignore");
  if (!existsSync(gitignorePath)) {
    try {
      writeFileSync(gitignorePath, GITIGNORE_BLOCK + "\n");
      repairs.push({ id: "gitignore_create", label: "Create .gitignore with Avorelo block", status: "applied", path: gitignorePath });
    } catch (e) {
      repairs.push({ id: "gitignore_create", label: "Create .gitignore", status: "blocked", reason: (e as Error).message });
    }
    return;
  }

  const content = readFileSync(gitignorePath, "utf8");
  if (content.includes(GITIGNORE_MARKER_START)) {
    repairs.push({ id: "gitignore_block", label: "Avorelo .gitignore block", status: "not_needed", path: gitignorePath });
    return;
  }
  if (content.includes(".avorelo/") || content.includes(".avorelo")) {
    repairs.push({ id: "gitignore_block", label: "Avorelo .gitignore entry", status: "not_needed", path: gitignorePath, reason: ".avorelo already in .gitignore" });
    return;
  }

  try {
    appendFileSync(gitignorePath, "\n" + GITIGNORE_BLOCK + "\n");
    repairs.push({ id: "gitignore_block", label: "Add Avorelo .gitignore block", status: "applied", path: gitignorePath });
  } catch (e) {
    repairs.push({ id: "gitignore_block", label: "Add Avorelo .gitignore block", status: "blocked", reason: (e as Error).message });
  }
}
