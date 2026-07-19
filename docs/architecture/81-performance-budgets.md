# 81 — Performance Budgets (Phase 12)

**Status:** DESIGN / PLANNING ONLY (no `src/avorelo/**` code; nothing migrated/copied)
**Decision:** `EFFICIENCY_PERFORMANCE_GO` (see end)
**Date:** 2026-06-08
**Authority basis:** `docs/architecture/20-canonical-architecture.md` (canonical spine,
`CANONICAL_ARCHITECTURE_GO`) + VERIFIED OpenHands SDK timing anchors. This doc expands the spine; it may
not contradict it. Any gap is recorded under **Risks / open questions**, not resolved by inventing
architecture.

---

## Purpose

Define the **latency and size budgets** that keep Avorelo feeling local-first and instant on the hot
path, and that prevent silent regression as the Kernel grows. Budgets exist because the spine puts the
Kernel singletons (Policy Matrix, Evidence Router, Stop/Continue Gate, Receipt Writer, secret scan,
Runtime/Sync Boundaries) on **every** invocation. If any one slips into hundreds of milliseconds, the
hook chain that wraps each agent turn (SessionStart → UserPromptSubmit → PreToolUse → … → Stop) becomes
the dominant cost and the tool stops being usable.

**Binding constraint (THE ONE RULE):** budgets here are properties the **Kernel singletons** own and
measure. No capability, skill, router, adapter, or surface defines its own budget, its own timer, or its
own regression suite — they call kernel-owned measurement and inherit the limits below. A surface that
needs more time files an Open Question; it does not raise its own ceiling.

**Scope mapping.** SessionStart / UserPromptSubmit / PreToolUse / Stop budgets govern the **Kernel**
hook seam. Fast-gate and secret-scan budgets govern the **Router/Kernel** boundary (S4 fast path).
Heavy-scan rules govern the **slow path** (async, off the turn). Dashboard payload governs the **Surface**
(local dashboard) and the **Sync Boundary**. Receipt-write governs the **Kernel Receipt Writer** (only
durable writer).

---

## Budget table

All numbers are **PROPOSED-to-validate** (see Note section). "Hot path" = synchronous, blocks the agent
turn. p50/p95/p99 are wall-clock on a typical dev laptop (no network, warm process). Measurement method
is the regression harness in **Enforcement**.

| # | Budget | Concrete target | Rationale | Measurement method |
|---|--------|-----------------|-----------|--------------------|
| B1 | **SessionStart max latency** | p95 ≤ 150 ms, p99 ≤ 300 ms (cold), ≤ 50 ms warm | Runs once per session; loads Work Contract + replays/loads State Ledger head. OpenHands replay is 4.1 ms VERIFIED, so the cost is contract parse + secret-scan of injected context, not state. One-time, so a looser ceiling than the per-turn hooks. | Bench harness invokes the SessionStart hook against a fixture contract + ledger; record cold (fresh process) and warm; assert percentiles. |
| B2 | **UserPromptSubmit / pre-context max latency** | p95 ≤ 80 ms, p99 ≤ 150 ms | Runs on every user turn before context is assembled. Must run the **pre-context secret scan** (S2) over candidate context. Perceived as typing-to-think delay, so it must stay sub-100 ms or the agent feels laggy. | Hook bench over fixture prompts + candidate-context payloads of graded size (1 KB / 64 KB / 512 KB); assert percentiles per size bucket. |
| B3 | **PreToolUse fast gate max latency** | p95 ≤ 20 ms, p99 ≤ 50 ms | Fires before **every** tool call: Policy Matrix lookup + S4 fast static scan (diff-only) + ownership-registry check (S5). High call frequency makes this the most budget-sensitive seam; it must be deterministic and table-driven (no model, no network — ADR-7). | Hook bench over a representative tool-call mix (read / edit / bash / network); assert p99 and assert zero network sockets opened. |
| B4 | **Stop Gate max latency** | p95 ≤ 60 ms, p99 ≤ 120 ms | Runs once per turn end to compute `{CONTINUE \| STOP_BLOCKED \| STOP_DONE}` + `safeNextActions` from current Evidence levels. Reads ledger head (cheap per OpenHands), evaluates evidence/policy; no heavy scan (that is slow-path, B9). | Hook bench with fixtures at each evidence level (NAV/INT/OUTCOME/POST_ACTION); assert verdict latency and that no receipt write occurs inside the gate timer. |
| B5 | **Compact status max lines** | ≤ 12 lines, ≤ 80 cols each (hard cap; ≤ 8 typical) | Approval + status surface is "compact" by spine mandate. A wall of text defeats fast human approval and buries the one decision that matters. Size budget, not latency. | Snapshot test on the status renderer: assert line count ≤ 12 and max column width across a matrix of states (blocked, needs_approval, done, iterating). |
| B6 | **Receipt write max latency** | p95 ≤ 30 ms, p99 ≤ 60 ms (single receipt, local) | Receipt Writer is the **only** durable writer and runs through shared redaction (S2). Anchored to OpenHands persist 0.20 ms VERIFIED for the raw append; the budget headroom is redaction + secret re-scan before write, not I/O. Off the critical typing path but must not stall STOP_DONE. | Bench the Receipt Writer over fixtures including secret-bearing payloads (must redact); assert latency and assert no raw secret in output (S2 invariant test, fails the bench on leak). |
| B7 | **Local dashboard payload max size** | ≤ 256 KB per view payload; ≤ 1 MB initial load | `avorelo open` reads local receipts/state; an unbounded payload makes the dashboard slow and tempts surfaces to over-fetch. Bounding the payload also bounds what the Sync Boundary could ever sanitize-and-ship (Pro/Teams). | Build a fixture workspace with N receipts; assert serialized view payload ≤ cap; assert pagination/summarization engages past the cap rather than growing the payload. |
| B8 | **Secret scan fast path max latency** | p95 ≤ 15 ms, p99 ≤ 40 ms per scanned unit (diff/context chunk) | S4 fast path = static regex/entropy scan, diff-only, sub-second gate. This is invoked inside B2 (pre-context) and B3 (pre-tool), so its budget must fit *inside* theirs. Must never call the model or network. | Bench the fast scanner over graded inputs (clean, near-miss, true positive); assert latency per KB and assert detection of seeded secrets (correctness gates the perf bench). |
| B9 | **Heavy scan slow path rules** | **No hard latency budget**; MUST be async/off-turn, MUST NOT block any hook in B1–B4, MUST be bounded by the **cost-abuse ceiling** (S4), MUST emit a ledger event on start/finish, and a receipt only on completion | Deep scans, browser proof, and visual diffs are inherently slow and variable; forcing a latency number would either cripple them or be meaninglessly large. The real invariant is **isolation** (never on the hot path) + **boundedness** (iteration/cost ceiling) rather than a single millisecond target. | Bench asserts the slow-path entry point returns control to the turn in ≤ B3 budget (it only *enqueues*), that completion arrives via ledger event, and that the cost-abuse ceiling halts a runaway loop in a fixture. |

---

## Enforcement (how budgets are tested / regressed)

1. **Kernel-owned bench harness.** A single `kernel/perf` harness (to be built post-gate-3) owns all
   timers and fixtures. Per THE ONE RULE, no surface/router/skill ships its own timing code; they are
   measured *by* the harness. Each budget B1–B9 is one bench case with named fixtures checked into the
   repo (no live network, deterministic seeds).
2. **Percentile assertions, not single runs.** Each case runs N iterations (proposed N ≥ 200 for hot-path
   gates) and asserts p95/p99 against the target, discarding a warmup window. A single slow run does not
   fail the build; a percentile breach does.
3. **Correctness gates perf.** Where a budget wraps a security function (B6 redaction, B8 secret
   detection), the bench **first** asserts the security invariant (no raw secret out; seeded secret
   detected) and only then asserts latency. A fast-but-leaky path fails the bench. This keeps S2 from
   ever being traded away for speed.
4. **Regression tripwire in CI fast path.** Hot-path budgets (B2–B4, B8) run on every change (they are
   themselves sub-second, so they fit the S4 fast lane). Heavier benches (B1 cold, B7, B9) run on a
   slower cadence (pre-land / nightly) to avoid taxing every commit.
5. **Budget changes are reviewed, not silent.** A target number lives in one kernel-owned config; raising
   a ceiling requires a diff to this doc + that config, so a regression cannot be "fixed" by quietly
   loosening the limit.
6. **Evidence, not vibes.** Each bench run emits a State Ledger event and (on pre-land) a receipt with the
   measured percentiles, so budget history is replayable like any other Kernel fact (ADR-1).

---

## Note: budgets are PROPOSED-to-validate

Every target in B1–B9 is a **proposed** number to be calibrated against real measurement before it is
treated as a contract — none is independently VERIFIED yet. Intuition is anchored to the **VERIFIED
OpenHands SDK** figures: **persist 0.20 ms**, **replay 4.1 ms**, **recovery < 20 ms**. Those tell us the
event-sourced state layer is effectively free relative to the hot path, so the budgets above are
deliberately spent on the parts the spine actually loads on every turn — **secret scanning, policy
evaluation, redaction, and context assembly** — not on state I/O. If validation shows state replay is the
bottleneck, that contradicts the VERIFIED anchors and must be investigated rather than absorbed by raising
a ceiling. All other comparative claims about "typical" hook latency are **UNVERIFIED** and exist only to
shape the first measurement, not to certify it.

---

## Risks / open questions

- **OQ-1 (hardware baseline).** "Typical dev laptop" is undefined. Need a named reference machine (CPU
  class, cold vs warm process) before percentiles mean anything. UNVERIFIED until set.
- **OQ-2 (process model).** Budgets assume a warm, resident Kernel process. If hooks spawn a cold
  interpreter per call, B2–B4 are likely unachievable. The activation/`doctor` flow must validate the
  process model; spine does not yet specify it.
- **OQ-3 (scan cost vs corpus size).** B8 is "per scanned unit" but the relationship between context size
  and scan time is unmeasured; the B2 size buckets are a guess. Risk that large pasted context blows the
  pre-context budget.
- **OQ-4 (dashboard cap behavior).** B7 assumes summarization/pagination exists when the cap is hit; that
  mechanism is not yet designed (belongs to the Surface + Sync Boundary docs). Add there, not here.
- **OQ-5 (cost-abuse ceiling units).** B9 defers boundedness to the S4 cost-abuse ceiling, but that
  ceiling's units (tokens? wall-clock? iteration count? $?) are not fixed in the spine. Cross-reference
  needed.
- **OQ-6 (percentile N).** N ≥ 200 for hot-path cases is proposed, not validated against variance; may be
  too few for stable p99. Calibrate during harness build.

---

## Skill Review

| Reviewer | Category | GO / NO_GO / PARTIAL | Basis |
|----------|----------|----------------------|-------|
| deep-research | external-claim verification | PARTIAL | Ran; confirmed OpenHands persist/replay/recovery figures as the only VERIFIED anchors. All B1–B9 targets remain UNVERIFIED/PROPOSED — research cannot certify Avorelo-specific budgets that have not been measured. |
| gstack-benchmark | performance regression | NEEDS_AVORELO_NATIVE_SKILL | Lead-applied conceptually (percentile bench + regression tripwire pattern). Operates on a running app via the browse daemon; cannot bench a design-only spec with no `src/avorelo` code. |
| gstack-health | code-quality / budgets | NEEDS_AVORELO_NATIVE_SKILL | Lead-applied (correctness-gates-perf, single-config-for-limits). No code to score; native Kernel `kernel/perf` harness required post-gate-3. |
| Architecture (self) | spine conformance (THE ONE RULE, S1–S5) | GO | Budgets are Kernel-owned and measured; no surface owns its own budget/timer/suite; S2 correctness gates perf (B6/B8); S4 fast/slow split honored (B8 vs B9); all numbers marked PROPOSED. |

**Decision:** `EFFICIENCY_PERFORMANCE_GO`
