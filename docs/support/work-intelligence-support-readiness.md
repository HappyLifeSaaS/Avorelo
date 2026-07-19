# Work Intelligence Support Readiness

**Date:** 2026-06-20
**Audience:** support, founders, internal demos

## How To Explain The Feature

Outcome:

- "This is Avorelo's local explanation of the latest AI work session."

Resume packet:

- "This is the safe carry-forward packet for the next session or another agent."

Context waste:

- "These are practical signals that some setup, references, or proof steps were missing, stale, or broader than needed."

Hygiene warnings:

- "These are trust warnings about receipts, artifacts, or routing behavior, not raw code inspection."

## What Support Can Safely Claim

- local-first post-session explanation
- provider-neutral resume packet
- safe next-step guidance
- basic and richer history boundaries based on plan
- privacy-safe aggregate telemetry events only

## What Support Must Not Claim

- exact savings or ROI
- automatic proof of every change
- team analytics product beyond waitlist
- source or prompt retention
- autonomous execution product

## Common Questions

Why does outcome say `open`?

- The work has not been fully proved or still has approval, proof, or scope gaps.

Why does resume say `needs_attention` or `unavailable`?

- The next session would need more proof, narrower scope, or missing continuity inputs before trusted continuation.

Why is context waste high?

- Common reasons are broad scope, missing proof command, stale references, or repeated setup without new evidence.

Why are there claims not allowed?

- Avorelo explicitly limits what can be said when proof or safety conditions are incomplete.

## Troubleshooting

- Run `avorelo work latest --json --target <dir>` to inspect the latest safe summary.
- Run `avorelo work context-waste --target <dir>` to see the specific waste warnings.
- Run `avorelo work hygiene --target <dir>` for the compact combined trust view.
- Run `avorelo work receipt-hygiene --target <dir>` for receipt trust issues.
- Run `avorelo work artifact-hygiene --target <dir>` when source-of-truth or generated-output warnings are suspected.
- Run `avorelo control-center --target <dir> --format text` for a compact local overview.
- If the cached summary is corrupted, rerun any `avorelo work ...` command. The CLI rebuilds from canonical local artifacts.
