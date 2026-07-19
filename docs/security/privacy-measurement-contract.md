# Privacy Measurement Contract

Status: Draft security/privacy contract for Avorelo Pulse. Human legal review required before production or public rollout.

## Hard Boundary

Telemetry must never persist or upload:
- source code
- raw prompts
- raw diffs or patches
- secrets
- env vars
- terminal output
- repo names
- org names
- remote URLs
- absolute file paths
- emails
- usernames
- customer data
- file contents

## Safe Replacements

- `durationMs` becomes `durationBucket`
- `errorMessage` becomes `errorClass`
- repo root becomes a local salted fingerprint
- session IDs become session fingerprints
- receipt IDs become receipt fingerprints
- remote URLs become provider enums only

## Client-Side Enforcement

The client sanitizer:
- rejects or strips unsafe field names
- rejects suspicious raw values
- hashes repo/session/receipt identifiers locally
- appends only sanitized events to the local log
- queues only upload-safe events

## Server-Side Enforcement (Double Gate)

The server applies a second, independent privacy gate:
- re-validates batch schema
- re-runs unsafe-field detection via `detectServerUnsafeTelemetry`
- rejects entire batch if any unsafe fields detected (422)
- applies `stripUnsafeObjectKeys` as a defense-in-depth layer on accepted events
- deduplicates replayed batch IDs and event IDs
- stores only sanitized event metadata
- exposes only aggregates by default via admin metrics

## Retention Draft

Draft retention targets:
- safe raw telemetry: 30 to 90 days
- daily aggregates: 24 months
- monthly aggregates: long-term

These windows are draft guidance until legal review completes.
