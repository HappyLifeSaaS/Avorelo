# Workflow Radar

## What it does

Workflow Radar creates a metadata-only workflow assessment for an active AI work session.
It helps answer whether work is still on track, whether changed paths drifted from the expected scope,
whether risky areas were touched, whether validation or evidence is still missing, and what the safest next
action should be.

CLI surface:

- `avorelo workflow radar`
- `avorelo workflow radar --json`
- `avorelo workflow radar --task "<task description>"`
- `avorelo workflow radar --from-context-brief`
- `avorelo workflow radar --from-model-route`
- `avorelo workflow radar check --path <path>`
- `avorelo workflow radar latest`

Artifact path:

- `.avorelo/workflow-radar/latest.json`

## What it does not do

- It does not replace Context Efficiency.
- It does not replace Model Routing Input.
- It does not replace Workspace Map.
- It does not replace Work Controls or capability routing.
- It does not create a new receipt or proof system.
- It does not scan raw diffs or raw source contents.
- It does not call providers or select vendor models.
- It does not guarantee correctness, production readiness, or complete drift detection.
- It does not replace code review.

## How it works

Workflow Radar reuses existing repo patterns:

- `context-efficiency` for expected scope, source-of-truth paths, and validation posture
- `model-routing-input` for expected AI work mode
- `work-controls` for approval and evidence expectations
- `proof-report` and local receipts for safe completion metadata
- git status path names only for changed-path inspection
- existing CLI nested-subcommand style
- existing `.avorelo/<capability>/...` local artifact conventions

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
- `contentStorageClass: "safe_metadata_only"`

## How it consumes Context Efficiency

If a latest Context Efficiency brief exists, Workflow Radar reuses its metadata-only expected scope,
source-of-truth paths, repo-area hints, blocked areas, and validation posture. If the brief is missing,
Workflow Radar falls back conservatively and says so rather than duplicating Context Efficiency logic.

## How it consumes Model Routing Input

If a latest Model Routing Input profile exists, Workflow Radar reuses the expected work mode and compares it
against the strictness implied by the changed paths. It does not select vendor models or call providers.
If the profile is missing, Workflow Radar falls back conservatively and says so.

## Relationship to Workspace Map

This base does not contain a standalone Workspace Map capability. Workflow Radar therefore reuses the same
conservative path-classification seam that Context Efficiency already uses. If Workspace Map lands later,
Workflow Radar can consume its safe metadata classifications without replacing or duplicating that system.

## Relationship to Work Controls

Workflow Radar reuses existing Work Controls evidence and approval expectations. It does not create a second
routing system and does not become a new source of routing truth.

## Relationship to receipts and proof

Workflow Radar looks only at safe metadata from proof reports and local receipts to detect whether validation
or completion evidence appears to be missing. It does not change receipt semantics, does not persist raw test
output, and does not create a parallel proof workflow.

## What drift means

Workflow drift means the changed path set no longer matches the expected scope for the session, or touches
paths that should stay out of normal AI editing flows such as generated output, local runtime artifacts,
release-owned files, production-sensitive files, billing or auth-sensitive files, or secret-sensitive files.

## What evidence gaps mean

Evidence gaps mean the changed path set suggests validation or receipt metadata should exist, but Workflow
Radar cannot find safe metadata that shows those checks or receipts are present yet.

## What changed-path inspection means

Workflow Radar reads git path metadata only:

- path names
- staged vs unstaged state
- untracked vs modified vs deleted state
- changed path counts

It does not persist raw diffs, raw file contents, raw prompts, raw terminal output, or provider payloads.

## Recommended next actions

Workflow Radar can recommend:

- `continue_work`
- `run_validation`
- `produce_receipt`
- `summarize_and_handoff`
- `ask_for_decision`
- `switch_to_guarded_mode`
- `stop_and_review`
- `unavailable`

## Limitations and claim boundaries

Allowed claims:

- detects workflow drift signals
- helps identify missing validation or evidence
- recommends safe next actions
- stores safe metadata only
- does not persist raw source or diffs
- helps keep AI work bounded and reviewable

Banned claims:

- guarantees the work is correct
- proves production readiness
- detects all drift
- detects all secrets
- prevents all agent mistakes
- replaces code review
- fully understands every repository
- fully validates the implementation
