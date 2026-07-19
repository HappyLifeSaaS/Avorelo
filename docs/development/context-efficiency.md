# Context Efficiency

## What it does

Context Efficiency creates a compact, metadata-only work brief before an AI coding session starts or resumes.
It helps the agent load less irrelevant context, inspect source-of-truth paths first, avoid generated output
and runtime artifacts, and end with explicit validation and evidence expectations.

CLI surface:

- `avorelo context brief`
- `avorelo context brief --json`
- `avorelo context brief --task "<task description>"`
- `avorelo context brief latest`
- `avorelo context brief check --path <path>`

Artifact path:

- `.avorelo/context-efficiency/latest-brief.json`

## What it does not do

- It does not replace Workspace Map.
- It does not replace Work Controls or capability routing.
- It does not implement a second model router.
- It does not create a new Control Center or dashboard.
- It does not persist raw source, prompts, diffs, env values, terminal output, screenshots, provider payloads, or customer data.
- It does not claim guaranteed token savings, perfect routing, or complete safety.

## How it works

Context Efficiency reuses existing repo patterns:

- `context-compiler` for bounded context and proof posture
- `work-controls` for capability and evidence expectations
- existing CLI `context` subcommand style
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
- `contentStorageClass: "safe_metadata_only"`

## Relationship to Workspace Map

This base does not contain a standalone Workspace Map capability. Context Efficiency therefore uses a narrow
compatibility seam with conservative fallback path rules. If Workspace Map lands later, the brief can consume
its safe metadata classifications without replacing or duplicating that system.

## Relationship to Work Controls

Context Efficiency is registered as a capability signal through the existing work-controls layer. It contributes
an expected evidence hint (`context_efficiency_brief`) but does not own routing truth, approval truth, or
receipt truth.

## Relationship to future Model Routing

This feature prepares safer task inputs and context boundaries. It does not select providers or vendor models.
Any future model-routing use should remain subordinate to the canonical routing kernel.

## Recommended validation

Typical commands depend on work type and path:

- `git diff --check`
- `npm run build`
- `npm run naming-check`
- `node --test tests/context-efficiency.test.ts`
- `node --test tests/context-efficiency-cli.test.ts`
- `npm run build:site`
- `npm run site:check`

## Limitations

- Fallback path classification is intentionally conservative until Workspace Map exists in base.
- Path checks are metadata-only and should not be treated as proof of correctness.
- The brief is a focus and safety aid, not code review, release readiness proof, or production approval.
