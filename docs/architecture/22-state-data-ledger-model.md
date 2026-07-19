# 22 — State / Data / Ledger Model (Phase 7)

**Status:** DESIGN / PLANNING ONLY (no `src/avorelo` written; no old code copied/migrated).
**Authority basis:** `20-canonical-architecture.md` (architecture spine, `CANONICAL_ARCHITECTURE_GO`)
is the source of truth this doc expands and may not contradict. Old-repo source mined for *concepts only*
from `repos/ClaudeCode-Optimizer/scripts/lib/work-ledger.js`, `.../unified-events.js`,
`.../proof-receipt.js`, and `src/avorelo-hub/receipts/receipt-redaction.ts`.
**Date:** 2026-06-08.

---

## Purpose

Define **how Avorelo persists truth**: the single event-sourced ledger, what every state item is, who
owns it, where it lives on disk, and what redaction applies. Per **THE ONE RULE** (doc 20 §1), there is
**exactly one** state store, one evidence model, one receipt writer, and one dashboard schema —
Kernel-owned singletons. Nothing in `capabilities/`, `skills/`, `routers/`, `adapters/`, or `surfaces/`
may invent its own store, gate, or receipt format.

This directly retires the old repo's drift: `work-ledger.js` alone enumerated **~100 `ENTRY_TYPES`** and
**~50 hardcoded `ARTIFACT_PATHS`**, each capability writing its own `latest-*.json` "latest-wins" file
(lines 13–186), while `unified-events.js` maintained **two parallel JSONL append logs**
(`outcome-events.jsonl` and cloud `outbox/events.jsonl`, lines 10–11). That is precisely the "15+ proof
systems / source-of-truth drift" failure (doc 20 §1). Here: **one append-only ledger; everything else is
a fold or a redacted projection.**

Invariant: **every state item below has a named owner module and a schema sketch.** No ownerless state.

---

## Ownership + storage table

All "storage location" paths are under `.avorelo/` (see §Local-first storage layout). All durable writes
pass through `kernel/receipts` → `shared/redaction` (doc 20 §3.7). "Owner" is always a Kernel module;
capabilities/surfaces only call it.

| State item | Owner module | Schema sketch (fields) | Storage location | Redaction rule |
|---|---|---|---|---|
| **Work Contracts** | `kernel/work-contract` | `{contractId, objective, allowedPaths[], requestedOutputs[], successCriteria[], stopConditions[], evidenceRefs[], reviewReasons[], planTier}` (doc 20 §3.1) | event in ledger (`contract.created`); current set = fold | `objective` truncated; no raw prompt text; paths kept (paths are not secrets) |
| **State/Event Ledger** | `kernel/state-ledger` | append-only `event{eventId, seq, ts, type, contractId, sessionId, actor, payload, redacted:true}` (doc 20 §3.2, ADR-1) | `events/ledger.jsonl` (append-only) | every event redacted **at write**; payload never holds raw secret/prompt/transcript |
| **Evidence records** | `kernel/evidence` | `{evidenceId, contractId, level: NAVIGATION\|INTERACTION\|OUTCOME\|POST_ACTION, kind, ref, grade, ts}` (doc 20 §3.3, ADR-3) | event (`evidence.submitted` / `evidence.graded`); large artifacts by **ref** under `artifacts/` | store ref + grade, not raw page/body; URLs kept, response bodies excluded |
| **Receipts** | `kernel/receipts` (only durable-receipt writer) | `{receiptId, contractId, decision, result, evidenceRefs[], claimBoundary, unverifiedClaims[], nextBoundedAction, redacted:true}` | `receipts/<contractId>.json` (+ rendered `.md`) | written **only** via `shared/redaction`; key-blocklist + length cap |
| **Measurements** | `kernel/receipts` (measurement projection) | `{window, byCategory{}, counts, confidenceLabel}` — counts only, **no $ savings claim** | `measurements/rollup.json` (derived; rebuildable from ledger) | aggregate counts only; no per-event payload; no guaranteed-savings figure |
| **Reviewer results** | `kernel/evidence` (verdict sink) → `kernel/stop-continue-gate` (consumer) | `{reviewerId, contractId, verdict: GO\|NO_GO\|PARTIAL, reasons[], evidenceRefs[]}` | event (`review.verdict`) | verdict + reason codes; reviewer prose truncated; no raw transcript |
| **Skill decisions** | `kernel/routing` (Skill Router) + intake (ADR-6) | `{skillId, trustTier: T0\|T1\|T2\|T3, loaded:bool, reason, provenanceRef}` | event (`skill.routed` / `skill.intake`) | record decision + tier; never embed skill body or secret-bearing args |
| **Capability routing decisions** | `kernel/routing` (Capability/Context/Tool/Model Routers) | `{decisionId, capabilityId, routerKind, chosen, candidates[], reasonCodes[], budget}` | event (`capability.routed`) | reason codes + ids only; no raw model output (routers are deterministic, ADR-7) |
| **Approval records** | `kernel/approval` | `{approvalId, contractId, actionClass, request{compact,typed}, state: pending\|approved\|denied, decidedBy, ts}` (doc 20 §3.6) | event (`approval.requested` / `approval.decided`) | compact typed request only; no secret in the request body |
| **Source-of-truth signatures** | `kernel/state-ledger` (integrity) | `{seq, prevHash, eventHash}` chaining per event (concept mined from `unified-events.js` `stableId` sha256, line 104) | embedded per ledger event | hash over **redacted** event only; tamper-evident, not a secret |
| **Local dashboard payload** | `kernel/receipts` + `shared/schemas` (surfaces render, never define — doc 20 §2) | `{contracts[], lastDecision, evidenceLevels, friction[], nextAction}` projection | `dashboard/payload.json` (derived) | redacted projection of ledger; surfaces get this, never raw events |
| **Optional cloud-safe sync metadata** | `kernel/sync-boundary` (only cloud path, doc 20 §3.9, ADR-5) | `{eventName, category, reasonCodes[], confidenceLabel, repoIdHash, ts}` — **metadata only** | `cloud/outbox.jsonl` (staged; sent only if cloud enabled) | sanitized: no raw secrets/prompts/logs/source/transcripts; ids hashed |
| **Legacy import/migration metadata** | `kernel/state-ledger` (import adapter, design-time only) | `{importId, sourceRepo, sourceArtifact, classification: preserve-concept\|mine-later\|rewrite-clean\|do-not-copy\|anti-pattern, mappedTo}` | `imports/manifest.json` (provenance only) | records *that* a concept was mined, never copies legacy payloads/secrets |

---

## Event-sourcing model (event shape, fold to state, replay, recovery)

ADR-1 (doc 20 §4): Kernel state is an **append-only event ledger**; current state is a **deterministic
fold**. VERIFIED anchor: OpenHands SDK (MIT, arxiv 2511.03690) — event-sourcing cut system failures ~61%
with sub-ms persist / few-ms replay (doc 20 ADR-1 evidence).

**Event shape** (one canonical envelope; mined-and-rewritten from `unified-events.js`
`buildUnifiedEventEnvelope` line 334, *not copied*):
```
{ eventId, seq, ts, type, contractId, sessionId, actor,
  payload (redacted), reasonCodes[], prevHash, eventHash, redacted: true }
```
`type` is a small **closed** set (e.g. `contract.created`, `capability.routed`, `evidence.submitted`,
`evidence.graded`, `review.verdict`, `policy.decided`, `gate.decided`, `approval.requested`,
`approval.decided`, `receipt.written`, `sync.staged`). Contrast the old `work-ledger.js` ~100-type sprawl
(lines 13–98): closed type set is the anti-drift guarantee.

**Fold to state.** Current state is never stored as a mutable blob (the old `latest-*.json` "latest-wins"
pattern, `work-ledger.js` lines 974–980). Instead `state = reduce(events, applyEvent)`:
- Work Contracts = fold of `contract.*` events.
- Evidence level per contract = max grade seen across `evidence.graded` events.
- Readiness = `STOP_DONE` only if folded evidence contains **OUTCOME + POST_ACTION** (ADR-3) — the fold
  cannot synthesize a level that was never an event, killing "no-404 = proof".

**Replay.** Re-fold from `seq=0` reproduces any past state deterministically (pause/resume, audit, "how
did we reach READY?"). Hash chain (`prevHash`/`eventHash`) makes the log tamper-evident.

**Recovery.** On crash, the last durable record is the last appended line in `events/ledger.jsonl`; a
partial trailing line is dropped (the old readers already tolerated malformed JSONL lines —
`work-ledger.js` `safeReadJsonl` line 209, `unified-events.js` `parseJsonl` line 18 — preserve that
tolerance). Derived files (`measurements/`, `dashboard/`, `imports/manifest.json`) are **rebuildable** by
re-fold; only `events/ledger.jsonl` is authoritative.

---

## Local-first storage layout (paths under `.avorelo/`)

Local-first, no signup (ADR-5). One canonical name `avorelo` (ADR-8) — **no `.claude/cco/...` tree** of
the old repo. Authoritative vs derived is explicit:

```
.avorelo/
  events/
    ledger.jsonl            # AUTHORITATIVE append-only event log (kernel/state-ledger)
  receipts/
    <contractId>.json       # durable receipts (kernel/receipts, redacted)
    <contractId>.md         # rendered receipt (surface read-only)
  artifacts/
    <evidenceId>.<ext>      # large evidence by-ref (screenshots, captured outputs), redacted
  measurements/
    rollup.json             # DERIVED counts projection (rebuildable)
  dashboard/
    payload.json            # DERIVED redacted projection for local surface (rebuildable)
  cloud/
    outbox.jsonl            # staged sanitized sync metadata (sent only if cloud enabled)
  imports/
    manifest.json           # legacy mining provenance (design-time; no copied payloads)
  config.json               # plan tier, cloud on/off, redaction policy version
```

Rule: anything outside `events/` (and `receipts/` as the durable outcome record) must be reconstructible
by re-folding the ledger. Deleting `measurements/`, `dashboard/`, `cloud/outbox.jsonl` loses nothing.

---

## Redaction + privacy rules (no raw secrets/prompts/transcripts by default)

Redaction is **mandatory at write**, owned by `shared/redaction` and invoked by the *only* receipt/event
writer (`kernel/receipts`, doc 20 §3.7). No module may bypass it (THE ONE RULE).

Concept mined from old `receipt-redaction.ts` (key-name blocklist + 500-char truncation, lines 1–40) and
the old `REDACT_ALWAYS` list (`prompt, transcript, raw_code, secret, *_token, api_key, password,
credential, private_key`, lines 1–18). **Rewrite-clean improvement** over the old design:

1. **Never store by default:** raw secrets, prompts, transcripts, source code bodies, response bodies,
   logs. These never enter `payload`; only refs/hashes/grades do.
2. **Allowlist-leaning, not blocklist-only.** The old key-substring blocklist (`shouldRedactKey`, line 22)
   is fail-open: an unknown sensitive key name slips through. Avorelo redaction defaults to **structured,
   typed payloads** where only declared safe fields are emitted; free-form maps are blocklist-scanned
   *and* length-capped as defense in depth. (Old blocklist = preserve-concept; blocklist-only =
   anti-pattern.) **UNVERIFIED:** exact false-negative rate of the old blocklist — not measured here.
3. **Length cap** (old `MAX_STRING_LENGTH = 500`, line 20): keep, as a backstop, not the primary control.
4. **Runtime Boundary** denies raw-secret *reads* to LLM/cloud regardless of platform sandbox (doc 20 §3.8,
   ADR-4) — so secrets never reach a place that could try to persist them.
5. Every persisted record carries `redacted: true` only when it actually passed `shared/redaction`. The
   old code hardcoded `redacted: true` as a literal regardless of processing (`work-ledger.js` line 264,
   `normalizeLedgerEntry`) — **anti-pattern**; the flag must mean "redaction ran," not "we hope so."

---

## Cloud-safe sync metadata (what may leave the machine)

Cloud is **optional** and the **only** path is `kernel/sync-boundary` (doc 20 §3.9, ADR-5). It emits
**sanitized metadata only**. Mined concept: old `unified-events.js` already had a cloud `outbox/events.jsonl`
and a stripped `buildUnifiedEventEnvelope` (lines 10, 334–354) plus `buildUnifiedBenefitRecord` (line 362)
— the *shape* is reusable; the **savings/minutes claims are not**.

**MAY leave the machine** (staged in `.avorelo/cloud/outbox.jsonl`):
- `eventName` / `category` (closed enum), `reasonCodes[]`, `confidenceLabel` (`low|medium|high`),
  `repoIdHash` (hashed, not raw repo path), counts, timestamps.

**MUST NOT leave** (ADR-5 explicit): raw secrets, prompts, transcripts, logs, source code, response bodies,
unhashed repo/user identifiers.

**Anti-pattern explicitly avoided:** the old `aggregateOutcomeEvents` emitted
`minutesSavedEstimate = loopsPrevented * 3` and dollar `measuredCostTotal` (`unified-events.js` lines
264–268, 230) — a **guaranteed-savings** claim. Avorelo sync carries **counts + confidence labels only**,
never a guaranteed savings or dollar figure (global rule: never over-claim). The "more-skills-hurt" /
savings magnitude remain **HYPOTHESES to measure**, not synced facts (doc 20 ADR-6).

---

## Old-repo lessons applied (work-ledger, unified-events, receipts)

| Old artifact | What it did | Classification | Applied lesson |
|---|---|---|---|
| `work-ledger.js` ~100 `ENTRY_TYPES`, ~50 `ARTIFACT_PATHS` (lines 13–186) | each capability wrote its own `latest-*.json`; ledger *scanned* them | **anti-pattern** (proof-system sprawl, source-of-truth drift) | replaced by ONE event ledger + closed type set; capabilities append events, never own files |
| `latest-ledger.json` "latest-wins" write (lines 974–980) | mutable snapshot, no history | **anti-pattern** | event-sourced; state is a fold, full replay (ADR-1) |
| `unified-events.js` dual JSONL logs (lines 10–11) | local `outcome-events.jsonl` + cloud `outbox` | **rewrite-clean** | one local ledger; cloud is a *projection* via sync-boundary only |
| `stableId` sha256 (line 104) | deterministic event ids | **preserve-concept** | reused for `eventId` + hash-chained `prevHash/eventHash` integrity |
| `minutesSavedEstimate`, `measuredCostTotal` (lines 230, 265) | guaranteed savings/$ claims | **anti-pattern** | counts + confidence labels only; no savings/$ claim |
| `receipt-redaction.ts` blocklist + cap (lines 1–40) | key-substring redaction | **preserve-concept** (blocklist) / **rewrite-clean** (make allowlist-leaning) | typed payloads + blocklist + cap as defense-in-depth |
| `proof-receipt.js` `cco/receipts/<session>.json\|.md`, anti-gaming (lines 9, 296–306) | per-session receipt + validation | **mine-later** | single Receipt Writer at `.avorelo/receipts/`; anti-gaming → Stop/Continue Gate (ADR-3) |
| `redacted: true` hardcoded literal (line 264) | flag set unconditionally | **anti-pattern** | flag means "redaction ran," set only by `shared/redaction` |
| `cco/wuz` naming, "Wuz Receipt" (proof-receipt line 211) | 3-way naming drift | **do-not-copy** | one name `avorelo` (ADR-8) |

---

## Risks / open questions

- **Ledger growth / compaction.** `events/ledger.jsonl` grows unbounded. *Open question:* snapshot-and-
  truncate strategy (periodic folded snapshot + tail) without breaking replay/hash-chain. Not specified in
  doc 20 → flagged here rather than invented.
- **Concurrent writers.** Multiple sessions/processes appending to one ledger needs an append lock or
  per-session segment then merge-by-seq. *Open question:* single-writer vs segmented ledger.
- **Hash-chain vs redaction ordering.** Hash must be over the **redacted** event so the chain is verifiable
  without secrets; confirm redaction is strictly before hashing in `kernel/receipts`.
- **Schema versioning / migration.** Old code carried `schemaVersion` (`work-ledger.js` line 8). Need an
  explicit event-schema version + forward fold for upgrades. *Open question:* version field placement.
- **Redaction false-negatives (UNVERIFIED).** Effectiveness of blocklist vs typed-allowlist is asserted,
  not measured; needs a redaction test-fixture suite (`shared/test-fixtures`) before any Pro/cloud claim.
- **Measurement honesty.** Counts-only is safe; but surfacing *any* aggregate risks re-introducing the
  savings-claim anti-pattern — guard with a "no guaranteed savings" lint on the sync schema.

---

## Skill Review

| Reviewer | Category | Verdict | Basis |
|---|---|---|---|
| architecture-review (event-sourcing / ownership) | avorelo-native-to-build | PARTIAL | lead-applied design critique vs doc 20 §1–3 + ADR-1; no native skill ran; live `plan-eng-review` recommended pre-impl |
| source-of-truth-review | avorelo-native-to-build (NEEDS_AVORELO_NATIVE_SKILL) | GO (design) | one ledger + closed type set + fold removes the old ~100-type / dual-log drift surfaces |
| redaction/privacy-review | harness-native (`cso`-style) | PARTIAL | invariants set from `receipt-redaction.ts` mining; full pass + fixtures deferred (Phase 9); allowlist gap UNVERIFIED |
| external-reference-review | external-reference (`deep-research`) | GO | event-sourcing anchored to VERIFIED OpenHands SDK (doc 20 ADR-1); deep-research genuinely ran in prior phase, not re-run here |
| old-repo-mining-review | existing-on-disk (`repos/ClaudeCode-Optimizer`) | GO | concepts mined from real files (`work-ledger.js`, `unified-events.js`, `proof-receipt.js`, `receipt-redaction.ts`); no code copied |

*No skill is claimed to have "run" in this phase. `deep-research` ran in the prior verified-core phase; the
reviewers above are lead-applied design critique or NEEDS_AVORELO_NATIVE_SKILL.*

### Decision: `STATE_MODEL_GO`
One Kernel-owned, event-sourced, hash-chained ledger under `.avorelo/events/` is the single source of
truth; every state item has a named owner + schema; all durable writes pass through `shared/redaction`;
cloud carries sanitized counts only. Old-repo proof-system sprawl, latest-wins snapshots, and guaranteed-
savings claims are classified out as anti-patterns.
