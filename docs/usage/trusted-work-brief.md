# Using the Trusted Work Brief

## Generating a brief

```sh
npx avorelo brief
```

This discovers your project context, evaluates trust and freshness, detects conflicts, infers work mode, and generates a concise Trusted Work Brief.

Output:
```
Avorelo Trusted Work Brief generated

Mode: feature_development
Confidence: 91%
Brief: .avorelo/work-briefs/latest.md
Receipt: .avorelo/receipts/context/work_brief_receipt_2026-...json

Included: 9
Excluded: 22
Conflicts: 3
Safety: production actions blocked, npm publish blocked

Required proof before completion:
  - targeted tests
  - receipt generated
  - context conflicts checked
```

## Reading the brief

The brief is at `.avorelo/work-briefs/latest.md`. It contains:

- **Current working truth** — what is known and verified right now
- **Detected mode** — feature_development, bugfix, release_verification, etc.
- **Must-follow constraints** — safety, production, publish, owner-only constraints
- **Relevant facts** — only verified/confirmed facts needed for this task
- **Open blockers** — unresolved conflicts and missing proof
- **Known risks** — risks the agent must account for
- **What not to assume** — false assumptions to explicitly avoid
- **Required proof before completion** — tests, receipts, verification steps
- **Suggested next safe actions** — what to do next
- **Source receipt references** — receipt IDs and paths for traceability

## Inspecting context status

```sh
npx avorelo context status
```

Shows current mode, trust summary, freshness summary, conflicts, stale items, and latest brief/receipt.

## Understanding conflicts

```sh
npx avorelo context conflicts
```

Lists all detected conflicts with conservative resolutions and required next proof.

## Verifying context

```sh
npx avorelo context verify
```

Re-checks working truth against current git state, receipts, and local state. Reports stale items, unsafe items, and unresolved conflicts.

## Understanding inclusions/exclusions

```sh
npx avorelo context explain
```

Shows which items were included in the brief and why, and which were excluded and why.

## Running diagnostics

```sh
npx avorelo doctor context
```

Checks for stale memory, unsafe memory, missing receipts, context bloat, conflicts, and unverified ready claims.

## What "proof pending" means

When the brief or status shows "proof pending", it means:
- No verification receipt has been generated yet for the current context
- The agent should not claim completion without generating proof first
- Run `npx avorelo prove` or targeted tests to generate verification evidence

## What to expect in agent sessions

When Avorelo generates a Trusted Work Brief:
- The agent receives only the smallest safe truth needed for the task
- Production actions (deploy, publish) are blocked unless explicitly approved
- Stale handoffs are excluded from working truth
- Secrets are redacted and never reach the agent
- Completion claims without proof are downgraded to "pending verification"
- Every decision is traceable through receipts
