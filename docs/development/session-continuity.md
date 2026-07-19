# Session Continuity

## What it does

Session Continuity creates a safe metadata-only handoff package for an AI work session.
It is designed to help the next session continue in the correct worktree and branch, inspect the right paths
first, avoid dangerous or unrelated paths, and see whether validation, evidence, or review is still missing.

CLI surface:

- `avorelo session handoff`
- `avorelo session handoff --json`
- `avorelo session handoff --task "<task description>"`
- `avorelo session handoff --from-workflow-radar`
- `avorelo session handoff --include-continuation-prompt`
- `avorelo session handoff check --path <path>`
- `avorelo session handoff latest`

Artifact path:

- `.avorelo/session-continuity/latest-handoff.json`

## What it does not do

- It does not replace Context Efficiency.
- It does not replace Model Routing Input.
- It does not replace Workflow Radar.
- It does not replace Workspace Map.
- It does not replace Work Controls or capability routing.
- It does not create a second receipt or proof system.
- It does not store raw source, raw prompts, raw diffs, raw secrets, raw env values, raw terminal output,
  provider payloads, screenshots, customer data, full repo snapshots, or full conversation transcripts.
- It does not guarantee perfect continuity, correctness, or production readiness.
- It does not replace code review.

## How it works

Session Continuity follows the same local metadata capability pattern as the upstream workstream helpers:

- it reuses Context Efficiency for source-of-truth scope and blocked-area guidance when available
- it reuses Model Routing Input for recommended work mode when available
- it reuses Workflow Radar as the primary drift, validation-gap, and evidence-gap signal when available
- it reuses Work Controls metadata instead of creating a second routing layer
- it reads git metadata only for worktree, branch, selected base inference, and changed path names
- it writes one local artifact under `.avorelo/session-continuity/`

It stores safe metadata only:

- `containsRawSource: false`
- `containsRawPrompt: false`
- `containsRawDiff: false`
- `containsRawSecret: false`
- `containsRawEnvValue: false`
- `containsRawTerminalOutput: false`
- `containsRawCustomerData: false`
- `containsRawScreenshot: false`
- `containsProviderPayload: false`
- `containsFullTranscript: false`
- `contentStorageClass: "safe_metadata_only"`

## How it consumes Context Efficiency

If a latest Context Efficiency brief exists, Session Continuity reuses its source-of-truth paths, blocked
areas, generated-output paths, runtime-artifact paths, and work type. If the brief is missing, Session
Continuity falls back conservatively and says so. It does not create a second brief generator.

## How it consumes Model Routing Input

If a latest Model Routing Input profile exists, Session Continuity reuses the recommended mode and the
comparison against the actual required mode derived from changed-path metadata. It does not call providers
and does not select vendor models.

## How it consumes Workflow Radar

Workflow Radar is the primary source for:

- workflow drift
- validation gaps
- evidence gaps
- changed path metadata
- human review requirements

If a latest Workflow Radar assessment is unavailable, Session Continuity generates a conservative local
fallback through the existing Workflow Radar API instead of duplicating that logic.

## How it may consume Workspace Map

If `.avorelo/workspace-map/latest.json` is present, Session Continuity reports that metadata as available.
If it is missing, Session Continuity falls back to the same conservative path-classification seam already
used by Context Efficiency and Workflow Radar.

## Relationship to Work Controls

Session Continuity reuses existing Work Controls selected capabilities, expected evidence, and reason codes
when those are already present in upstream artifacts. It does not create a parallel capability router.

## Relationship to receipts and proof

Session Continuity looks only at safe proof metadata and receipt metadata:

- latest proof report presence
- verified count
- latest receipt id
- receipt count
- expected evidence keys from upstream metadata

It does not change receipt semantics and does not create a new proof workflow.

## What the handoff package contains

The handoff package includes:

- workstream name and task summary
- current stage
- current worktree, branch, head, and selected base
- dependency-branch notes when relevant
- relevant changed path names only
- inspect-first paths
- do-not-touch boundaries
- validation and evidence gaps
- safe-to-continue decision
- continuation mode
- recommended next action
- continuation prompt
- closure criteria

## What the continuation prompt contains

The generated continuation prompt includes:

- workstream name
- current branch and worktree
- selected base
- dependency note if relevant
- safe next action
- relevant changed path names
- validation and evidence gaps
- explicit do-not-touch boundaries
- required closure criteria

It excludes raw source, raw diffs, raw terminal output, provider payloads, secrets, env values, and full
transcripts.

## Dependent branches

If the current branch appears to depend on another branch, Session Continuity marks that as a dependency
signal, switches the continuation mode to `wait_for_dependency_merge`, and recommends retargeting or rebasing
after the dependency merges. This does not block local handoff generation.

## Validation and evidence gaps

Session Continuity distinguishes:

- `NEEDS_VALIDATION` when changed source paths exist but proof metadata is still missing
- `NEEDS_EVIDENCE` when validation metadata exists but receipt metadata is still missing
- `NEEDS_REVIEW` when risky review-heavy paths were touched
- `BLOCKED` when blocked or production/release-owned paths were touched

## Parallel development support

Session Continuity is intended to help parallel development stay bounded:

- it tells the next session which worktree and branch to keep using
- it surfaces dependency branches without silently retargeting
- it highlights generated, runtime, release, billing, auth, dashboard, and secret-sensitive boundaries
- it keeps the handoff package compact and metadata-only instead of copying a transcript

## Limitations and claim boundaries

Allowed claims:

- creates safe metadata-only handoff packages
- helps continue AI work across sessions
- summarizes changed path names without raw diffs
- helps identify validation and evidence gaps
- recommends safe next actions
- does not persist raw source, diffs, or transcripts

Banned claims:

- guarantees perfect continuity
- guarantees the next agent will be correct
- proves production readiness
- stores the full conversation safely
- detects all drift
- detects all secrets
- prevents all agent mistakes
- replaces code review
- fully understands every repository
- fully validates the implementation
