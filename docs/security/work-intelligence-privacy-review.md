# Work Intelligence Layer Security And Privacy Review

**Date:** 2026-06-20  
**Status:** PASS for local-first metadata-only scope

## What is stored

Stored locally:

- outcome status
- proof status
- attempted-change summary
- safe next actions
- safe reference labels and kinds
- routing summary
- hygiene warnings
- context waste warnings
- aggregate telemetry event names and counts

## What is never stored

- raw prompts
- raw source
- raw diffs
- terminal output
- env values
- secrets
- raw repo names
- remote URLs
- customer emails
- absolute user paths
- provider payload dumps

## Artifact guarantees

The Work Intelligence summary and resume packet both declare:

- `containsRawPrompt: false`
- `containsRawSource: false`
- `containsRawEnvValue: false`
- `containsRawSecret: false`
- `containsRawDiff: false`
- `containsRawTerminalOutput: false`

## Redaction strategy

Visible carry-forward strings are sanitized before persistence or rendering:

- email addresses -> redacted
- remote URLs -> redacted
- env-style `KEY=value` strings -> redacted
- absolute user paths -> redacted

Validation now rejects artifacts when unsafe visible text survives in:

- objective summary
- failures/open-state lists
- next-session needs
- resume packet state/risk/next-action fields

## No-leak proof

Validated by:

- `tests/work-intelligence.test.ts`
- `tests/work-intelligence-cli.test.ts`
- `tests/control-center.test.ts`
- aggregate-safe telemetry assertion in `tests/work-intelligence.test.ts`

Specific adversarial cases covered:

- blocked risky task containing a secret-like string
- objective text containing an email, remote GitHub URL, env-style value, and absolute path
- rendered text surfaces
- rendered HTML surfaces
- CLI JSON output
- corrupted-cache rebuild path
- receipt-hygiene contradiction path

## Abuse and failure cases reviewed

- secret-bearing task text should not leak through the summary
- blocked or approval-required sessions should still produce safe guidance
- unsupported completion claims should be downgraded and warned
- missing proof must not silently appear as success
- missing or corrupted Work Intelligence cache must rebuild from existing truth, not fail open
- generated output must not be treated as canonical public-web source without a matching static source reference

## Telemetry boundary

Allowed aggregate events:

- `work_intelligence_generated`
- `resume_packet_generated`
- `context_waste_detected`
- `hygiene_warning_detected`

Deferred:

- next action accepted
- next action ignored

Reason:

- the current product does not observe those behaviors directly enough to emit them honestly.
