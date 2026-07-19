# Work Intelligence Reconciliation

**Date:** 2026-06-20  
**Status:** reconciled against local git state, remote reality, and current implementation

## What was claimed by the previous session

The previous session reported that Work Intelligence already existed across:

- `src/avorelo/capabilities/work-intelligence/index.ts`
- runtime-flow integration
- persisted context packets
- CLI work-intelligence commands
- capability middleware free-command gating
- Control Center read model support
- aggregate-safe telemetry event types
- tests, dogfood, docs, and a public article

It also implied the work was effectively complete.

## What exists now

The underlying Avorelo architecture already had the right truth sources:

- `runtime-flow` for the canonical session spine
- `kernel/work-controls` for readiness, proof posture, approval posture, and final decision ownership
- `control-router` for router/scanner/skill/capability composition
- receipts and proof reports for durable evidence
- continuity and context compiler outputs for carry-forward state
- entitlement resolution for plan boundaries
- Pulse telemetry infrastructure for aggregate-only local events
- Control Center for a read-only operator surface

Those systems already existed before this reconciliation and remain the canonical sources of truth.

## What was actually present before this session

Before this session, Work Intelligence artifacts were present only as local workspace changes:

- the main implementation files existed locally
- the tests, docs, dogfood script, and public article also existed locally
- the files were not present in the fetched remote branch
- no Work Intelligence PR was visible in `gh pr list --state all`
- `git log --all -- <work-intelligence files>` showed no local commit history for the core new files

In short: the feature work was real local work, but it was not yet canonical git history and not yet remotely evidenced.

## What was missing or incomplete

The reconciliation found several gaps:

- no canonical remote branch or PR evidence
- privacy leakage remained possible in `objectiveSummary`
- no explicit validator checks for unsafe visible text inside summary/resume fields
- no combined hygiene CLI surface and no artifact-hygiene CLI subcommand
- Control Center only showed Work Intelligence counts, not a compact next-action preview
- the reconciliation doc did not describe local-only reality versus remote reality
- the review matrix was decorative instead of decision/risk/evidence-oriented

## What is now reused

Work Intelligence remains a composition layer over existing truth:

- `runtime-flow`: latest execution/session record
- `kernel/receipts` and `proof-report`: evidence and proof posture
- `continuity`: safe next actions and carry-forward state
- `context-compiler`: selected refs, allowed context, proof tier, and routing context
- `kernel/work-controls`: readiness, approval, proof expectations, and final decision owner
- `control-router`: diagnostic replay only, never a second router
- model/primitive routing: read-only summary of what was selected
- Pulse telemetry: aggregate-safe event names and counts only
- entitlement resolution: Free/Pro/Teams boundaries
- Control Center: read-only projection of Work Intelligence outputs

## What must not be duplicated

- no parallel router
- no parallel receipt schema
- no parallel proof truth
- no parallel telemetry pipeline
- no parallel dashboard truth source
- no raw prompt/source/diff/log/terminal/env/secret persistence
- no surveillance framing or heavy analytics layer

## Composition map

### 1. Runtime-flow

`runtime-flow` remains the canonical session spine. Every runtime session updates Work Intelligence after the runtime artifacts already exist.

### 2. Receipts and proof reports

Outcome Receipt 360 is a projection over receipt/proof truth. It can say `proved`, `open`, `blocked`, or `unavailable`, but it never invents proof or completion.

### 3. Continuity

Continuity remains the carry-forward source. Work Intelligence sanitizes and repackages continuity into a provider-neutral resume packet.

### 4. Context compiler

Context packet and context pack metadata feed workspace relevance, stale-reference detection, broad-scope detection, and generated-output/source-of-truth mismatch checks.

### 5. Work-controls

Kernel work-controls remain the final owner of readiness, approval gating, and proof expectations. Work Intelligence only reports the resulting posture.

### 6. Control-router

Control-router may be replayed for routing diagnostics, but replay is informational only. It does not own the final decision.

### 7. Model and primitive routing

Model profile, primitive, and adapter selections are summarized as read-only routing outputs. Model output never owns readiness, proof, savings, or completion.

### 8. Pulse telemetry

Pulse remains aggregate-only. Work Intelligence only emits real event names and counts for real local behavior:

- `work_intelligence_generated`
- `resume_packet_generated`
- `context_waste_detected`
- `hygiene_warning_detected`

### 9. Entitlements

Entitlement resolution still owns Free/Pro/Teams boundaries. Work Intelligence consumes those boundaries and does not create a second pricing system.

### 10. Control Center

Control Center reads Work Intelligence artifacts and renders a compact summary. It does not create truth, mutate capability state, or become a second evidence owner.

## Explicit architectural confirmations

- Kernel remains the decision owner.
- Model output never owns readiness, proof, savings, or completion.
- Scanner output informs decisions but does not own final decisions.
- Control Center reads truth and does not create truth.
- Pulse remains aggregate-only.
- Work Intelligence is a compact explanation layer, not a heavy dashboard or surveillance product.

## Reference learning applied

The implementation intentionally borrowed patterns, not product shape, from adjacent systems:

### Claude Code lifecycle and hooks lessons

- session start/end thinking maps to runtime-session creation and post-session summary generation
- pre-tool/post-tool and stop points map to approval, proof, and blocked/open outcomes
- compaction lessons map to metadata-only carry-forward instead of raw session retention
- permission decision points map to preserving approval posture in the summary and resume packet

### Codex CLI lessons

- rules and boundaries stay explicit instead of inferred
- hooks/skills/MCP thinking informs composition, but truth remains in local Avorelo artifacts
- non-interactive automation lessons shaped deterministic CLI outputs and exit codes
- approval and security posture is surfaced without exposing raw execution payloads

### MCP lessons

- consent/control: no hidden external writes or surprise escalation
- privacy: metadata-only summaries and aggregate-only telemetry
- tool safety: execution posture summarized, not blindly trusted
- explicit approvals: approval-required sessions stay open, not silently completed
- access boundaries: local roots and canonical source-of-truth boundaries are preserved
- logging/error reporting: warnings are explicit, safe, and compact
- cancellation/boundaries: blocked/open states are first-class and preserved honestly

## Final reconciliation summary

Work Intelligence was not imaginary; it existed locally. But it was not yet canonical, fully proved, or fully hardened. This reconciliation keeps the real local work, closes the privacy and hygiene gaps, and documents the feature as a composition layer over existing Avorelo truth rather than a parallel system.
