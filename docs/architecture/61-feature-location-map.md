# 61 — Feature Location Map (Phase 14)

**Status:** DESIGN / PLANNING ONLY (no `src/avorelo/**` code; nothing migrated/copied/renamed)
**Decision:** `SURFACE_MODEL_GO` (see end)
**Date:** 2026-06-08
**Authority basis:** `docs/architecture/20-canonical-architecture.md` (canonical spine,
`CANONICAL_ARCHITECTURE_GO`) + `21-runtime-product-flows.md` + `40-governed-skills-routing-optimization.md`.
This doc expands the spine's layer map (doc 20 §1) and ownership table (doc 20 §2); it may not
contradict them. Any gap is recorded under **Risks / open questions**, never invented.

---

## Purpose

Give an implementer a single lookup: for each **feature / surface**, *where the code lives*
(`src/avorelo/...`), *which Kernel contracts it composes* (never re-implements), *where its tests live*,
*how it relates to launch*, and whether it is **core-now** (first runnable slice) or **later**. The map
is the authority for placement only — behavior is owned by docs 20/21/40 and by THE ONE RULE: no
capability, skill, router, adapter, or surface owns its own policy engine, evidence model, receipt
writer, approval logic, dashboard schema, readiness gate, or state store. Each maps to exactly one
home layer (Kernel / Capability / Skill / Router / Adapter / Surface) and *calls* the Kernel singletons.

Test-location convention: unit/contract tests colocate as `<module>/__tests__/`; cross-layer ownership
tests (the THE-ONE-RULE enforcement suite) live in `shared/test-fixtures/ownership/`; live dogfood/QA
(browser proof, doctor) live under `tests/e2e/`. Paths below are **proposed placement**, not existing files.

---

## Map table

Kernel contract abbreviations: **WC**=Work Contract, **SL**=State/Event Ledger, **ER**=Evidence Router
(NAV→INT→OUTCOME→POST_ACTION), **PM**=Policy Matrix, **SCG**=Stop/Continue Gate, **AP**=Approval,
**RW**=Receipt Writer (+`shared/redaction`), **RB**=Runtime Boundary, **SB**=Sync Boundary,
**RT**=Routers. All surfaces are read-only over Kernel outputs + trigger approved actions.

### Kernel singletons (own everything; depend on no other layer)

| Feature / surface | Target src path | Kernel contracts | Tests location | Launch relevance | core-now/later |
|---|---|---|---|---|---|
| Work Contract | `kernel/work-contract/` | owns WC | `kernel/work-contract/__tests__/` | bounds every session | core-now |
| State/Event Ledger | `kernel/state-ledger/` | owns SL (append-only, fold, replay) | `kernel/state-ledger/__tests__/` | persistence/replay/recovery | core-now |
| Evidence Router | `kernel/evidence/` | owns ER + 4 levels | `kernel/evidence/__tests__/` | kills fake-READY | core-now |
| Policy Matrix | `kernel/policy/` | owns PM `{allow\|block\|needs_approval}` | `kernel/policy/__tests__/` | safety floor (ADR-4) | core-now |
| Stop/Continue Gate | `kernel/stop-continue-gate/` | owns SCG + `safeNextActions` | `kernel/stop-continue-gate/__tests__/` | READY needs OUTCOME+POST_ACTION | core-now |
| Approval | `kernel/approval/` | owns AP (compact typed) | `kernel/approval/__tests__/` | destructive/external gating | core-now |
| Receipt Writer | `kernel/receipts/` | owns RW + dashboard payload schema | `kernel/receipts/__tests__/` | only durable writer | core-now |
| Runtime Boundary | `kernel/runtime-boundary/` | owns RB (fs/net/secret) | `kernel/runtime-boundary/__tests__/` | denies raw-secret reads (S2) | core-now |
| Sync Boundary | `kernel/sync-boundary/` | owns SB (sanitized egress) | `kernel/sync-boundary/__tests__/` | optional cloud only | later |
| Security cross-cut (S1–S5) | `kernel/security/` | composes PM+RB+SB+RW | `kernel/security/__tests__/` | OWASP AST01-10, invariants | core-now (S1/S2/S5), later (full audit) |

### Routers (deterministic + cheap; declare needs, never hardcode/own policy)

| Feature / surface | Target src path | Kernel contracts | Tests location | Launch relevance | core-now/later |
|---|---|---|---|---|---|
| Capability Router | `routers/capability/` | calls WC; selects feature | `routers/capability/__tests__/` | entry of spine | core-now |
| Evidence Router shell | `routers/evidence/` | delegates grading to `kernel/evidence` | `routers/evidence/__tests__/` | grades each artifact | core-now |
| Context Router | `routers/context/` | enforces context budget; calls PM | `routers/context/__tests__/` | context hygiene + secret pre-scan trigger | core-now |
| Skill Router | `routers/skill/` | calls AP for external skills; intake/trust-tier | `routers/skill/__tests__/` | nothing loads by default (ADR-6) | core-now (gate), later (depth) |
| Tool Router | `routers/tool/` | classifies action class for PM/AP | `routers/tool/__tests__/` | feeds PreToolUse block point | core-now |
| Model Router | `routers/model/` | cheapest-correct; budget | `routers/model/__tests__/` | cost discipline | later |
| Approval Router | `routers/approval/` | calls AP; role/ACL (Teams) | `routers/approval/__tests__/` | gates external/destructive | core-now (basic), later (role) |

### Capabilities (the 27 features; compose Kernel, own no proof/policy)

| Feature / surface | Target src path | Kernel contracts | Tests location | Launch relevance | core-now/later |
|---|---|---|---|---|---|
| activation | `capabilities/activation/` | WC, RB, RW, SCG | `capabilities/activation/__tests__/` + `tests/e2e/activation/` | `npx avorelo activate` first slice | core-now |
| source-of-truth (drift gate) | `capabilities/source-of-truth/` | submits ER evidence; PM blocks drift | `capabilities/source-of-truth/__tests__/` | highest-priority native gate (doc 03 #14) | core-now |
| secret (Secret Guard) | `capabilities/secret/` | detection only → RB+PM hard block | `capabilities/secret/__tests__/` | S2 secret invariant | core-now |
| scope-repair | `capabilities/scope-repair/` | reconciles prompt vs WC | `capabilities/scope-repair/__tests__/` | prevents silent drift | core-now |
| session-collision | `capabilities/session-collision/` | submits ER evidence; PM+AP gate cleanup | `capabilities/session-collision/__tests__/` | stale-process/dirty-worktree safety | core-now |
| autonomous-iteration loop | `capabilities/iteration/` | reads SCG `CONTINUE`; budget via RT | `capabilities/iteration/__tests__/` | bounded by cost ceiling (S4) | later (depth=Pro) |
| remediation | `capabilities/remediation/` | applies fixes in `allowedPaths`; SCG | `capabilities/remediation/__tests__/` | Pro autonomous fix | later |
| payment-readiness | `capabilities/payment-readiness/` | drives proof; ER grades POST_ACTION | `capabilities/payment-readiness/__tests__/` + `tests/e2e/payment/` | kills redirect=payment | later (Pro) |
| cloud-claim | `capabilities/cloud-claim/` | assembles payload; SB only egress; AP | `capabilities/cloud-claim/__tests__/` | optional claim (ADR-5) | later |
| teams-rollup | `capabilities/teams-rollup/` | aggregates sanitized receipts; AP role | `capabilities/teams-rollup/__tests__/` | Teams governed exposure | later |
| (remaining of 27 — see `docs/capabilities/*`) | `capabilities/<name>/` | compose Kernel; own nothing | `capabilities/<name>/__tests__/` | per capability doc | mostly later |

### Skills (governed reviewers; verdict is input to SCG, never finalizing)

| Feature / surface | Target src path | Kernel contracts | Tests location | Launch relevance | core-now/later |
|---|---|---|---|---|---|
| skill intake pipeline | `skills/_intake/` | ed25519 sig + sha256 + scan-before-load (S3); AP | `skills/_intake/__tests__/` | governance floor | core-now (gate) |
| production-confidence reviewer | `skills/production-confidence/` | returns verdict → SCG | `skills/production-confidence/__tests__/` | gates READY (qa/review) | later |
| security-review reviewer | `skills/security-review/` | returns verdict → SCG/PM | `skills/security-review/__tests__/` | maps to `cso` (reference) | later |
| architecture-review reviewer | `skills/architecture-review/` | returns verdict → SCG | `skills/architecture-review/__tests__/` | design critique (`plan-eng-review`) | later |

### Adapters (translate outside world; act only through RB)

| Feature / surface | Target src path | Kernel contracts | Tests location | Launch relevance | core-now/later |
|---|---|---|---|---|---|
| claude-code adapter | `adapters/claude-code/` | acts via RB; writes hook config | `adapters/claude-code/__tests__/` | primary execution + hook wiring | core-now |
| filesystem adapter | `adapters/filesystem/` | via RB (read/write mediated) | `adapters/filesystem/__tests__/` | ledger store I/O | core-now |
| git adapter | `adapters/github/` (+ `local-env`) | via RB; HEAD/dirty/diff | `adapters/github/__tests__/` | drift + collision evidence | core-now |
| local-env adapter | `adapters/local-env/` | via RB; toolchain/process | `adapters/local-env/__tests__/` | doctor + collision | core-now |
| browser adapter | `adapters/browser/` | via RB; INT/POST_ACTION capture | `adapters/browser/__tests__/` + `tests/e2e/` | visual/payment proof | later (Pro) |
| ci-cd adapter | `adapters/ci-cd/` | via RB; test results | `adapters/ci-cd/__tests__/` | outcome evidence | later |
| vercel / netlify adapters | `adapters/vercel/`, `adapters/netlify/` | via RB | `adapters/<name>/__tests__/` | deploy adapters | later |
| codex / cursor / generic-cli | `adapters/codex/`, `adapters/cursor/`, `adapters/generic-cli/` | via RB | `adapters/<name>/__tests__/` | alt runtimes | later |
| cloud adapter | `adapters/cloud/` | behind SB only | `adapters/cloud/__tests__/` | optional sync | later |

### Surfaces (read-only over Kernel outputs; trigger approved actions only)

| Feature / surface | Target src path | Kernel contracts | Tests location | Launch relevance | core-now/later |
|---|---|---|---|---|---|
| CLI | `surfaces/cli/` | reads RW/SL; triggers WC/AP | `surfaces/cli/__tests__/` | primary day-1 surface | core-now |
| activation-flow | `surfaces/activation-flow/` | reads doctor/receipt; triggers AP | `surfaces/activation-flow/__tests__/` | `avorelo activate` UX | core-now |
| local-dashboard | `surfaces/local-dashboard/` | renders Kernel payload schema | `surfaces/local-dashboard/__tests__/` | `avorelo open` (Free) | core-now (read), later (rich) |
| pr-comments | `surfaces/pr-comments/` | renders reviewer verdicts | `surfaces/pr-comments/__tests__/` | review surface | later |
| cloud-dashboard | `surfaces/cloud-dashboard/` | renders sanitized rollups (post-SB) | `surfaces/cloud-dashboard/__tests__/` | Pro/Teams | later |
| teams-rollups | `surfaces/teams-rollups/` | renders sanitized aggregates; AP role | `surfaces/teams-rollups/__tests__/` | Teams | later |
| public-web | `surfaces/public-web/` | static; no Kernel state | `surfaces/public-web/__tests__/` | marketing/docs | later |

---

## Cross-check vs THE ONE RULE (no surface owns policy/evidence/receipt)

- **Every non-Kernel row's "Kernel contracts" column names a *call*, not an *own*.** Only the ten Kernel
  rows say "owns". Routers/capabilities/skills/adapters/surfaces all read or submit; none declares its
  own PM, ER, SCG, RW, AP, SL, RB, SB, or dashboard schema.
- **Surfaces (`surfaces/*`) own zero contracts.** They render the Kernel-owned dashboard payload schema
  (`kernel/receipts` + `shared/schemas`) and may only *trigger* approved actions (WC create, AP respond).
  `local-dashboard`/`cloud-dashboard`/`teams-rollups` never define a schema (kills old 20+-gate drift).
- **Receipts:** only `kernel/receipts` (RW) writes durable receipts, always via `shared/redaction`.
  Capabilities `request` a receipt; the map gives no capability a receipt-writer path (kills old 15+
  proof systems).
- **Evidence:** capabilities/adapters *submit* to ER; `routers/evidence` is a thin shell that delegates
  to `kernel/evidence`. No layer grades its own evidence.
- **Policy:** Context/Tool/Approval routers *classify and call* PM; they cannot return `allow` over a
  `block`. Skills' verdicts are SCG inputs, never PM overrides (ADR-4).
- **Enforcement of the rule itself** is the ownership test suite in `shared/test-fixtures/ownership/`:
  a static check that no path outside `kernel/` exports a policy/evidence/receipt/approval/gate/schema/
  state symbol (S5 capability-collision = ownership registry). This suite is **core-now**.

---

## Risks / open questions

- **Capability count vs map coverage.** Only ~10 of the stated 27 capabilities are placed explicitly
  here; the rest are folded into one `capabilities/<name>/` row pending `docs/capabilities/*`. Exact
  names/count are **UNVERIFIED** against a finalized capability registry — resolve in the capability docs,
  do not invent here.
- **Test-path convention is proposed.** Colocated `__tests__/` + `tests/e2e/` + `shared/test-fixtures/`
  is a design choice consistent with the spine; the actual harness layout is **UNVERIFIED** until tooling
  (Phase 12/15) is fixed.
- **git adapter home.** Placed under `adapters/github/` per doc 20 §1, but local git (HEAD/dirty/diff)
  vs GitHub-API actions may warrant splitting; open for the adapter design phase.
- **Ownership static-check feasibility.** Whether a purely static import/export scan can fully enforce
  THE ONE RULE (vs runtime registry) is **UNVERIFIED**; may need both. Fail-closed if ambiguous.
- **Surface ↔ schema versioning.** When the Kernel dashboard payload schema evolves, surfaces must not
  fork it; a schema-version contract is unspecified and belongs under the receipts/schema design.
- **External claims:** all Claude Code hook/permission and OpenHands SDK references inherit from doc 02;
  nothing new is asserted here. Marginal-utility "more-skills-hurt" remains a **HYPOTHESIS to measure**.

---

## Skill Review (this doc)

| Reviewer | Category | Verdict | Basis |
|---|---|---|---|
| architecture-review (`plan-eng-review`) | existing-on-disk | PARTIAL | lead-applied critique of placement↔spine consistency (doc 20 §1/§2); live interactive run needs repo+toolchain — not claimed to have run |
| external-reference-review (`deep-research`) | harness-native | GO | rests on the `deep-research` run behind doc 02; this map adds no new external claim and marks gaps UNVERIFIED |
| source-of-truth-review | avorelo-native-to-build | GO (design) | every non-Kernel row *calls* Kernel singletons; ownership test suite placed in `shared/test-fixtures/ownership/` — `NEEDS_AVORELO_NATIVE_SKILL` to enforce |
| security-review (`cso` / built-in) | existing / harness-native | PARTIAL | S2/S3/S5 placements set (RB, secret cap, intake pipeline, ownership registry); full audit deferred to Phase 9 — no `src/` code yet |

*No gstack skill is claimed to have "run" for this doc. `deep-research` genuinely ran (doc 02); the others
are lead-applied design critique or `NEEDS_AVORELO_NATIVE_SKILL`.*

---

### Decision: `SURFACE_MODEL_GO`
