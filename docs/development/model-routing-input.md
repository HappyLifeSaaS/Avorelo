# Model Routing Input

## What it does

Model Routing Input creates a metadata-only routing profile before AI coding work starts or resumes.
It consumes Context Efficiency outputs when available, summarizes task shape and path risk, and recommends
the safest AI work mode without calling any provider or selecting any vendor model.

CLI surface:

- `avorelo model route`
- `avorelo model route --json`
- `avorelo model route --task "<task description>"`
- `avorelo model route --from-context-brief`
- `avorelo model route check --path <path>`
- `avorelo model route latest`

Artifact path:

- `.avorelo/model-routing/latest-profile.json`

## What it does not do

- It does not call model APIs or provider APIs.
- It does not select real vendor models.
- It does not replace the canonical model-routing kernel.
- It does not duplicate Context Efficiency.
- It does not replace Workspace Map.
- It does not replace Work Controls or capability routing.
- It does not persist raw source, prompts, diffs, secrets, env values, terminal output, screenshots,
  provider payloads, or customer data.
- It does not claim guaranteed correctness, safety, or production readiness.

## How it works

Model Routing Input reuses existing repo patterns:

- `context-efficiency` for bounded task inputs and safe context guidance
- `context-compiler` through Context Efficiency rather than reimplementing context sizing logic
- `work-controls` for capability, evidence, and approval expectations
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

If a latest Context Efficiency brief already exists, `avorelo model route --from-context-brief` uses that
brief as the upstream input. Otherwise, the feature can build a fresh Context Efficiency brief from the task
and consume its metadata-only output. This keeps routing-input logic subordinate to the existing context layer
instead of re-deriving source-of-truth paths, validation posture, and safety hints independently.

## Relationship to Workspace Map

This base does not contain a standalone Workspace Map capability. Model Routing Input therefore reports
Workspace Map as unavailable and uses the same conservative path-classification seam that Context Efficiency
already uses. If Workspace Map lands later, this feature may consume its safe metadata classifications without
replacing or duplicating that system.

## Relationship to Work Controls

Model Routing Input reads Work Controls capability/evidence expectations from Context Efficiency outputs and
surfaces them in the routing profile. It does not own routing truth, approval truth, receipt truth, or
capability truth.

## Why it does not call providers

This feature is an input-layer recommendation surface only. Its job is to recommend an AI work mode such as
`standard_reasoning` or `human_review_required`, not to resolve a provider, call a model, or choose a vendor-
specific model identifier. Provider selection remains outside this capability.

## Routing modes

- `simple_fast`
- `standard_reasoning`
- `deep_reasoning`
- `guarded_high_risk`
- `human_review_required`
- `blocked_needs_decision`

## Recommended validation

Typical commands depend on risk, work type, and touched paths:

- `git diff --check`
- `node --test tests/model-routing-input.test.ts tests/model-routing-input-cli.test.ts`
- `npm run dogfood:model-routing-input`
- `npm run build`
- `npm run naming-check`
- `npm run package:check`
- `npm run readiness:local`
- `npm run test:local`

Higher-risk or broader work should also keep the Context Efficiency validation commands attached to the
upstream brief and should prefer tighter scope before any AI-assisted execution.

## Limitations and claim boundaries

- The profile is advisory metadata, not execution approval.
- Path checks are metadata-only and should not be treated as proof of correctness.
- Workspace classification is intentionally conservative until Workspace Map exists in base.
- `human_review_required` and `blocked_needs_decision` are safety signals, not evidence that the work is done.
- The persisted artifact is safe for local reuse only and does not contain raw task inputs or provider payloads.
