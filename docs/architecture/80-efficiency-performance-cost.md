# 80 — Efficiency / Performance / Cost Architecture (Phase 12)

**Status:** DESIGN / PLANNING ONLY (no `src/avorelo/**` code; nothing migrated/copied)
**Decision:** `EFFICIENCY_PERFORMANCE_GO` (see end)
**Date:** 2026-06-08
**Authority basis:** `docs/architecture/20-canonical-architecture.md` (canonical spine, `CANONICAL_ARCHITECTURE_GO`)
+ `40-governed-skills-routing-optimization.md` (router budgets) + VERIFIED OpenHands SDK perf anchors.
This doc expands the spine (S4 fast/slow path + cost-abuse ceiling); it may not contradict it. Any gap is
recorded under **Risks / open questions**, not resolved by inventing architecture.

---

## Purpose

Specify how Avorelo stays **cheap, bounded, and fast** without trading away safety or truth. Concretely:

1. Define the **fast path vs slow path** split (S4) and which work each owns.
2. Define the **caching, scan-scoping, and diff-only** rules that keep the hot path sub-second.
3. Define explicit **byte/token/cost budgets** for every surface that can balloon (status, dashboard
   payload, browser proof, secret scan, telemetry, context, model/skill routing).
4. Define the **autonomous-iteration cost ceiling** (the S4 cost-abuse guard).
5. Pin **Free/Pro/Teams** cost boundaries without paywalling basic safety/truth/recovery.

**Binding constraint (THE ONE RULE):** no capability/skill/router/adapter/surface owns its own budget,
gate, or state. Budgets are **Kernel-owned policy** (`kernel/policy` cost classes) measured against the
event-sourced **State Ledger**; the **Stop/Continue Gate** is the only thing that returns `STOP_BLOCKED`
when a ceiling is hit. Efficiency is a *cross-cutting Kernel concern* (S1), not a per-skill optimization.

---

## Fast path vs slow path (S4)

Two execution lanes, selected **deterministically** by the routers (no LLM in the lane decision, ADR-7):

| Lane | Target | Owns | Examples |
|---|---|---|---|
| **Fast path** | **sub-second**, p99 < ~1s, no network, diff-only | every interactive gate, every router decision, secret pre-context scan, static AST scan on the diff | hook fires on edit → secret-scan diff → Policy verdict → Gate `CONTINUE/STOP_BLOCKED` |
| **Slow path** | seconds–minutes, **async**, network/browser allowed | deep scans, browser/visual proof, heavy post-session repo scans, outcome+post-action evidence collection | payment-readiness proof, full-tree secret sweep, visual regression |

Rules:
- **Default to the fast path.** The slow path runs only when a readiness claim or an explicit Pro depth
  step demands OUTCOME/POST_ACTION evidence (ADR-3) that the fast path cannot produce.
- The fast path is **diff-scoped**: it never scans the whole repo in the hot loop.
- The slow path is **bounded and async**: it cannot block the interactive loop, and it is itself capped by
  the cost-abuse ceiling (below). A slow-path step that overruns its budget returns `STOP_BLOCKED` with
  `safeNextActions`, never a silent timeout.
- A readiness step **never silently downgrades** from slow to fast to save cost (that would forge proof).

---

## Evidence caching; scan scope; diff-only checks; heavy post-session scans

- **Evidence caching.** Graded evidence (NAV/INT/OUTCOME/POST_ACTION) is recorded as State Ledger events
  and **content-addressed** (artifact hash). A re-run with an unchanged diff + unchanged inputs reuses the
  cached grade instead of re-collecting it. Cache key = `{contractId, diffHash, artifactHash, evidenceLevel}`.
  **Invariant:** cache is keyed on inputs, so a code change **invalidates** the cached READY — proof cannot
  go stale silently. POST_ACTION evidence for a payment-class claim is **never** served from cache past its
  declared freshness window (conservative default; exact TTL is an open question).
- **Scan scope.** Static/secret scans run **diff-only** on the fast path. The full-tree sweep is a slow-path,
  post-session job. Scope is bounded by the Work Contract `allowedPaths` (Context Router already excludes
  out-of-scope files), so scan cost scales with the change, not the repo.
- **Diff-only checks.** Lint/type/AST/secret checks on the hot path consume only the changed hunks +
  minimal dependency closure, not the file set. This is what keeps the interactive gate sub-second.
- **Heavy post-session scans.** Full-tree secret sweep, dependency-vuln scan, and broad evidence
  reconciliation are deferred to an **async post-session** pass (slow path). They emit ledger events and can
  raise a follow-up `needs_approval`/`STOP_BLOCKED` on the *next* contract — they never block the session
  that scheduled them. Replay perf is feasible because the ledger is event-sourced (ADAPT from VERIFIED
  OpenHands SDK: persist ~0.20ms / replay ~4.1ms / recovery <20ms — these are SDK-measured anchors, treated
  as the design target, **UNVERIFIED for Avorelo** until first dogfood benchmark).

---

## Context budget; model routing; skill routing overhead

- **Context budget.** The Context Router assembles the **minimal** bundle and enforces a token/byte ceiling
  by **dropping lowest-priority items first** (progressive disclosure), never truncating mid-secret and
  never truncating mid-artifact. Redaction (`shared/redaction`) runs before assembly, so the budget is
  measured on *redacted* content. Default load set for skills is **empty** (no all-skills-in-every-prompt).
- **Model routing.** The Model Router is a sub-ms static table lookup `(step kind + planTier) → model
  profile`; cheap utility passes get a cheap profile, Pro depth/proof steps get the deeper profile. The
  routing decision uses **no model** (ADR-7); only the work step calls an LLM. Budget exhaustion on a
  readiness step → `STOP_BLOCKED`, never a silent downgrade to a weaker model.
- **Skill routing overhead.** Routing is set-intersection over indexed triggers (sub-ms). The real cost of a
  skill is its **loaded context + its model passes**, which is exactly why a skill's `performance budget`
  is a **measured** manifest field and the marginal-utility eval gates promotion. Loading a skill that does
  not help on a matched signal is a *cost regression* and is caught by the eval, not assumed away.

---

## Status output budget; dashboard payload budget; browser proof budget; secret scan budget; telemetry cost

Every surface that historically ballooned gets an explicit, Kernel-owned ceiling:

| Surface | Budget rule | Failure mode |
|---|---|---|
| **Status output** (`avorelo` CLI / Gate result) | Bounded, **structured** summary: verdict + top reasons + `safeNextActions`. Hard line/byte cap; detail lives behind a drill-down ref into the ledger, not in the inline dump. | Over-cap → truncate the *detail tail*, keep verdict + next action intact (never bury the decision). |
| **Dashboard payload** | Sanitized, paginated **rollup** of receipts/events; server/local sends summaries + refs, not raw artifacts. Per-request byte cap; client fetches detail on demand. | Over-cap → paginate; never inline full transcripts/artifacts. |
| **Browser proof** (slow path, Pro) | Capped step count, capped screenshot count (stored as **refs**, not inline blobs), per-proof wall-clock cap. | Over-cap → `STOP_BLOCKED` with partial evidence graded honestly (not auto-promoted to READY). |
| **Secret scan** | Fast path = **diff-only**, sub-second, pre-context (S2: scan-before-load). Full sweep = slow path, async. | A raw secret is **blocked at the runtime boundary** regardless of budget — security never yields to a cost cap (S1/S2). |
| **Telemetry cost** | **Sanitized metadata only** across the Sync Boundary (S2: no raw secret/content to cloud/logs). Sampled + aggregated; local-first by default; cloud emission is opt-in (`avorelo claim`). | Over-cap → sample/drop low-value events; **never** drop a security/readiness event to fit budget. |

**Invariant (S2):** no budget rule may cause a raw secret, raw transcript, or unredacted artifact to reach
the LLM, cloud, logs, receipts, or dashboard. Truncation always drops *low-priority detail*, never *safety*.

---

## Autonomous-iteration cost ceiling (cost-abuse guard)

S4 requires autonomous iteration to be **bounded**. The Kernel enforces a per-contract ceiling so a stuck
loop cannot burn unbounded model/tool spend:

- **Counters (ledger-derived):** iteration count, cumulative model token/cost estimate, tool-call count,
  wall-clock, and **no-progress streak** (consecutive iterations with no new graded evidence).
- **Ceiling = whichever trips first.** On trip, the **Stop/Continue Gate** returns `STOP_BLOCKED` with
  `safeNextActions` (e.g., "narrow scope", "request approval for more depth", "human review") — it does
  **not** silently continue and does **not** silently stop as if done (`STOP_DONE` requires real evidence).
- **No-progress guard.** N iterations with no evidence-level advance (no NAV→INT→OUTCOME→POST_ACTION
  movement) → `STOP_BLOCKED`. This kills the "spin forever, looks busy, proves nothing" anti-pattern.
- **Tier-scaled depth, not tier-scaled safety.** Free gets a low iteration ceiling (still enough for basic
  recovery); Pro gets deeper autonomous iteration; Teams adds governed ceilings + approval. The *ceiling*
  scales by tier; the *guard itself* never turns off (S4).
- **Ownership (S5/THE ONE RULE):** the ceiling is one Kernel-owned policy class. No capability/skill sets
  or raises its own ceiling; a skill can only *request* more depth via `needs_approval`.

---

## Free / Pro / Teams cost boundaries

| Tier | Gets (cost-bounded) | Boundary rule |
|---|---|---|
| **Free** | Local kernel, all gates, secret-block, fake-READY block, local receipts, diff-only fast-path checks, **bounded** autonomous iteration | **Never paywall basic safety/truth/recovery.** Cost is bounded by low iteration ceiling + local-only (no cloud emission); slow-path browser/visual proof is not included. |
| **Pro** | Deeper autonomous iteration (higher ceiling), browser/visual proof (slow path), payment-readiness, optional cloud claim | Higher cost ceilings + slow-path lanes unlocked; still bounded by the cost-abuse guard. Cloud emission opt-in, sanitized only. |
| **Teams** | Governed exposure, sanitized rollups, role/approval gating | Adds *governance* cost controls (org ceilings, approval-gated depth, sanitized rollup payload caps); never weakens the per-contract guard. |

**Non-negotiable:** the free tier always gets correct verdicts, secret-blocking, fake-READY-blocking, and
recoverable next actions. Tiers gate **depth and exposure**, not **honesty**.

---

## Old-repo lesson (cco-status 9940-line dump anti-pattern)

Old repo = `ClaudeCode-Optimizer` (**source material only**; no code copied this phase).

- **Anti-pattern observed:** `cco-status` emitted a ~9,940-line status dump (figure cited from old-repo
  artifacts; **UNVERIFIED** exact count, but the *shape* — unbounded inline status — is the real lesson).
  It conflated status, evidence, and raw detail into one giant inline blob: expensive to produce, expensive
  to read, and it buried the actual decision.
- **Fix → bounded structured status.** Status output is verdict + top reasons + `safeNextActions`, under a
  hard cap, with detail behind a ledger drill-down ref (see Status output budget above). The decision is
  always visible; the firehose is opt-in and paginated.
- **Fix → single source of truth.** The old dump duplicated state that lived in many places; here the
  ledger is the one event-sourced source and the dashboard/status are **bounded projections** of it (THE
  ONE RULE: surfaces own no state/schema).
- **Fix → cost is a budget, not a byproduct.** Every output surface has an explicit ceiling, so "huge dump"
  is structurally impossible rather than a thing to remember not to do.

---

## Risks / open questions

- **Budget numbers are placeholders.** The exact byte/token/line caps, the iteration ceiling values, and
  the no-progress streak length need first-dogfood data before they can be pinned; current values are a
  conservative design floor.
- **OpenHands perf anchors are SDK-measured, not Avorelo-measured.** The persist/replay/recovery figures are
  ADAPT targets (VERIFIED for the SDK, `arxiv 2511.03690` MIT); whether Avorelo's ledger hits them is
  **UNVERIFIED** until a Phase 12+ benchmark.
- **Evidence-cache freshness TTL.** The freshness window for cached OUTCOME/POST_ACTION evidence (esp.
  payment-class) is unspecified; defer to the security/evidence detailing rather than invent a TTL now.
- **cco-status 9940-line figure is UNVERIFIED.** The precise line count is an old-repo recollection; the
  anti-pattern stands regardless of the exact number.
- **Perf benchmark harness is avorelo-native-to-build.** Measuring fast-path latency, context-budget
  drop behavior, and the cost ceiling needs a NEEDS_AVORELO_NATIVE_SKILL benchmark runner; the on-disk
  `gstack-benchmark` is reference-only and was **not run** for this design.
- **Telemetry sampling policy.** Sampling rates and the keep-always event classes (security/readiness) are
  sketched, not specified; defer to the Sync Boundary detailing.

---

## Skill Review

| Reviewer | Category | Verdict | Basis |
|---|---|---|---|
| external-reference-review | harness-native `deep-research` | GO | `deep-research` genuinely ran in prior phases; the OpenHands SDK perf anchors (persist/replay/recovery, MIT `arxiv 2511.03690`) underpin the caching/replay ADAPT targets. |
| performance-architecture-review | avorelo-native-to-build (NEEDS_AVORELO_NATIVE_SKILL) | GO (design) | fast/slow split + diff-only scope + per-surface budgets are consistent with ADR-7 + S4; reviewed as lead-applied design critique, not an executed skill. |
| cost-abuse-guard-review | avorelo-native-to-build (NEEDS_AVORELO_NATIVE_SKILL) | PARTIAL | ceiling shape + no-progress guard defined; threshold values are placeholders until first dogfood data. |
| perf-benchmark | existing-on-disk `gstack-benchmark` | NO_GO (until built) | requires a running app + Avorelo-native harness; reference-only, **not run** this phase. Live benchmark needed before numbers can gate. |
| security-review | existing-on-disk `gstack-cso` | PARTIAL | S1/S2 invariants (no budget yields a raw secret; security events never sampled out) set a floor; full pass in the security phase. Not run — design critique only. |
| eng-plan-review | existing-on-disk `gstack-plan-eng-review` | PARTIAL (lead-applied; live run recommended pre-impl) | requires repo + toolchain; deferred per honesty rule. Not run — lead-applied design critique only. |

*No skill is claimed to have "run" that did not. `deep-research` genuinely ran (prior phases). gstack/anthropic
skills here are lead-applied design critique or NEEDS_AVORELO_NATIVE_SKILL.*

### Decision: `EFFICIENCY_PERFORMANCE_GO`
