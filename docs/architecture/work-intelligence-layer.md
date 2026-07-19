# Work Intelligence Layer

**Date:** 2026-06-20
**Status:** Implemented locally, validated with targeted tests and dogfood

## Purpose

The Work Intelligence Layer is Avorelo's post-session explanation and carry-forward domain. After each AI work session, it composes existing local truth into one safe summary:

- what the work was
- what was attempted
- what was proved
- what remains open
- what should happen next
- what context looked useful, stale, or wasteful

It does this without persisting raw prompts, raw source, raw diffs, terminal output, env values, secrets, repo names, or remote URLs.

## Module Map

Canonical inputs:

- `src/avorelo/capabilities/runtime-flow/index.ts`
- `src/avorelo/capabilities/context-compiler/index.ts`
- `src/avorelo/capabilities/continuity/index.ts`
- `src/avorelo/capabilities/proof-report/index.ts`
- `src/avorelo/capabilities/value-ledger/index.ts`
- `src/avorelo/kernel/receipts/index.ts`
- `src/avorelo/telemetry/`
- `src/avorelo/capabilities/billing/entitlement-resolver.ts`

Work Intelligence domain:

- `src/avorelo/capabilities/work-intelligence/index.ts`
- `src/avorelo/dogfood/work-intelligence.ts`
- `tests/work-intelligence.test.ts`
- `tests/work-intelligence-cli.test.ts`

Read-only product surfaces:

- `src/avorelo/surfaces/cli/avorelo.ts`
- `src/avorelo/surfaces/cli/capability-middleware.ts`
- `src/avorelo/capabilities/control-center/index.ts`

## Data Flow

1. `runtime-flow` writes the runtime session, continuity, proof report, value entries, and context packet.
2. `runtime-flow` calls `upsertWorkIntelligence(...)` for both allow and non-allow outcomes.
3. `work-intelligence` reads existing local artifacts and composes:
   - Outcome Receipt 360
   - Work Memory
   - Workspace Map and Relevance
   - Context Waste
   - Hygiene projections
   - Provider-neutral Resume Packet
4. The layer writes only safe metadata artifacts under `.avorelo/work-intelligence/`.
5. CLI and Control Center read those artifacts. They do not create truth or recalculate ownership decisions.
6. Aggregate-safe Pulse telemetry events are recorded only for observable, real behavior.

## Source Of Truth Ownership

Ownership stays unchanged:

- Kernel work-controls own final decision authority.
- Control router owns routing selection.
- Runtime flow owns session progression and orchestration.
- Existing receipts remain durable proof truth.
- Proof report remains the proof projection.
- Continuity remains next-run continuity truth.
- Pulse remains aggregate-only telemetry truth.
- Control Center remains read-only.

Work Intelligence is a composed explanation layer over those truths. It is not a new router, receipt authority, telemetry authority, or dashboard truth source.

## Stored Artifacts

Artifacts written by this layer:

- `.avorelo/work-intelligence/latest.json`
- `.avorelo/work-intelligence/history.jsonl`
- `.avorelo/work-intelligence/resume.latest.json`
- `.avorelo/work-intelligence/resume.history.jsonl`

Contract names:

- `avorelo.workIntelligence.v1`
- `avorelo.workResumePacket.v1`

These contain safe metadata only. `contentStored` is true because metadata is intentionally stored, and `contentStorageClass` is `safe_metadata_only`.

## Privacy Model

Hard invariants on both primary artifacts:

- `containsRawPrompt: false`
- `containsRawSource: false`
- `containsRawSecret: false`
- `containsRawDiff: false`
- `containsRawTerminalOutput: false`

Additional rules:

- no raw repo names
- no remote URLs
- no env values
- no customer identifiers
- no free-form transcript persistence
- telemetry records counts and status only

## Failure Modes

- Missing runtime session: deterministic fallback builds from continuity and other local artifacts.
- Corrupted cached summary: CLI rebuilds from canonical local truth.
- Blocked or approval-required task: summary still persists with safe next actions and claim restrictions.
- Missing proof: outcome stays open, claims are restricted, waste warnings surface.
- Stale or contradictory receipts: hygiene warnings surface, but no receipt ownership is transferred.
- Missing telemetry eligibility: local summary still works; telemetry remains best-effort only.

## Invariants

- Work Intelligence must not introduce a parallel truth path.
- Unavailable is never treated as zero.
- Savings are not claimed without measured comparative evidence.
- Claims not allowed are always present.
- Teams remains waitlist-only in this domain.
- Provider-specific handoff views are projections over one provider-neutral resume packet.

## Explicit Deferrals

- No production deployment
- No npm publish
- No GitHub release/tag
- No live billing actions
- No team analytics product beyond waitlist boundaries
- No raw event inspection UI
