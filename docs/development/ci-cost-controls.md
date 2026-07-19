# CI Cost Controls

## Why this exists

This repository is private. GitHub Actions minutes are charged to the owner. Feature development branches (`planning/**`, `impl/**`, `chore/**`, `fix/**`, `feat/**`, `codex/**`) and pull requests were automatically consuming CI budget with no release value.

CI is now restricted to release-critical paths only.

## Which branches trigger CI automatically

| Branch pattern | CI runs automatically |
|---|---|
| `main` | Yes — all tiers |
| `release/**` | Yes — all tiers |
| Everything else | No |

## Which branches do NOT trigger CI

- `planning/**`
- `impl/**`
- `chore/**`
- `fix/**`
- `feat/**`
- `codex/**`
- Pull requests (any target, any source)

## What feature sessions should run locally

Before pushing or opening a PR, validate locally:

```bash
npm run build
npm run naming-check
npm run test:local
npm run package:check
npm run readiness:local
```

For Tier 2 equivalent coverage:

```bash
npm run dogfood:all                  # deterministic local suite (no external CLI, no network)

# Optional maintainer checks — require a real, authenticated external CLI.
# Never part of the canonical required CI gate.
npm run dogfood:optional-real-tools  # needs the Claude Code / Codex CLIs
npm run dogfood:optional-claude-live # needs an authenticated `claude` CLI
```

## Manual CI triggers (workflow_dispatch)

The workflow retains `workflow_dispatch` so the owner can intentionally run CI when needed.

**Rules:**
- `workflow_dispatch` requires explicit owner approval
- Agents must not use `workflow_dispatch` without owner approval
- Agents must not rerun failed GitHub Actions jobs
- Agents must not push multiple iterations to trigger CI repeatedly

## Production closure

Production closure is the only context where full CI budget is intentionally spent:

1. Code lands on `main` via merge — CI runs automatically (all tiers)
2. Code lands on `release/**` — CI runs automatically (all tiers)
3. Owner may use `workflow_dispatch` to validate specific branches before merge

All other CI consumption is waste and must be avoided.
