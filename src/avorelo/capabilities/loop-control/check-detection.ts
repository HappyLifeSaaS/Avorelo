import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { LoopCheckResult } from "../../shared/schemas/index.ts";

export type DetectedCheck = {
  checkId: string;
  label: string;
  command: string;
  source: string;
};

function detectFromPackageJson(cwd: string): DetectedCheck[] {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return [];
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const scripts = pkg.scripts ?? {};
    const checks: DetectedCheck[] = [];

    if (scripts["test:local"]) {
      checks.push({ checkId: "chk_npm_test_local", label: "npm test:local", command: "npm run test:local", source: "package.json" });
    } else if (scripts.test && scripts.test !== 'echo "Error: no test specified" && exit 1') {
      checks.push({ checkId: "chk_npm_test", label: "npm test", command: "npm test", source: "package.json" });
    }

    if (scripts.lint) {
      checks.push({ checkId: "chk_npm_lint", label: "npm lint", command: "npm run lint", source: "package.json" });
    }
    if (scripts.typecheck || scripts["type-check"]) {
      const key = scripts.typecheck ? "typecheck" : "type-check";
      checks.push({ checkId: "chk_npm_typecheck", label: `npm ${key}`, command: `npm run ${key}`, source: "package.json" });
    }

    return checks;
  } catch { return []; }
}

function detectFromPython(cwd: string): DetectedCheck[] {
  if (existsSync(join(cwd, "pytest.ini")) || existsSync(join(cwd, "pyproject.toml")) || existsSync(join(cwd, "setup.py"))) {
    return [{ checkId: "chk_pytest", label: "pytest", command: "python -m pytest", source: "python" }];
  }
  return [];
}

function detectFromGo(cwd: string): DetectedCheck[] {
  if (existsSync(join(cwd, "go.mod"))) {
    return [{ checkId: "chk_go_test", label: "go test", command: "go test ./...", source: "go.mod" }];
  }
  return [];
}

function detectFromRust(cwd: string): DetectedCheck[] {
  if (existsSync(join(cwd, "Cargo.toml"))) {
    return [{ checkId: "chk_cargo_test", label: "cargo test", command: "cargo test", source: "Cargo.toml" }];
  }
  return [];
}

export function detectCheckCommands(cwd: string): DetectedCheck[] {
  return [
    ...detectFromPackageJson(cwd),
    ...detectFromPython(cwd),
    ...detectFromGo(cwd),
    ...detectFromRust(cwd),
  ];
}

export function detectedChecksToLoopChecks(detected: DetectedCheck[]): LoopCheckResult[] {
  return detected.map(d => ({
    checkId: d.checkId,
    label: d.label,
    command: d.command,
    type: "shell" as const,
    required: true,
    lastResult: "not_run" as const,
    lastOutput: null,
  }));
}
