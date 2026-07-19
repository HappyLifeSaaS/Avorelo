# 20 — Canonical Architecture (Phase 5)

**Status:** COMPLETE (lead-authored architecture spine)
**Decision:** `CANONICAL_ARCHITECTURE_GO`
**Date:** 2026-06-08
**Authority basis:** VERIFIED external core (Claude Code docs + OpenHands SDK, `02-...md`) + old-repo
lessons (`01-...md`). This doc is the **single source of architectural truth**; all other Phase 4–16
docs expand from it and may not contradict it.

> **Spine update (controlling):** `planning/08-architecture-synthesis-before-continuation.md` adds five
> mandatory changes **S1–S5** (security as a Kernel-cross-cutting domain; hard secret invariants incl.
> overriding Accept-Edits `rm`; signed+scanned skill intake; fast/slow split + cost ceilings;
> mechanized capability-collision prevention). Detailed in `security/50-51`. Where S1–S5 are stricter,
> they govern.

---

## 0. One-paragraph architecture

Avorelo is an **AI Work Control Kernel**. A small, deterministic **Kernel** owns all policy, state,
evidence, receipts, approval, and routing decisions. **Capabilities** are the product features; they
*compose* Kernel contracts but own no policy/proof of their own. **Skills** are governed, progressively
-disclosed reviewers/workflows behind a trust-tiered intake. **Routers** decide *what* runs (capability,
skill, context, tool, model, approval, evidence) cheaply and deterministically. **Adapters** translate
to/from the outside world (Claude Code, git, CI, browser, cloud). **Surfaces** only *read* Kernel
outputs and *trigger approved* actions — they own nothing. The hard line, taken straight from the
verified Claude Code model: **instructions/memory are context, never enforcement — anything that must
hold is enforced by deterministic Kernel gates (hooks), which can tighten but never loosen.**

---

## 1. Layer map and the one rule

```
src/avorelo/
  kernel/        work-contract · policy · state-ledger · evidence · routing ·
                 runtime-boundary · approval · receipts · stop-continue-gate · sync-boundary
  capabilities/  (27 features — see docs/capabilities/*)
  skills/        governed reviewers/workflows (trust-tiered)
  routers/       capability · skill · context · tool · model · approval · evidence
  adapters/      claude-code · codex · cursor · generic-cli · github · vercel · netlify ·
                 local-env · ci-cd · browser · filesystem
  surfaces/      cli · local-dashboard · cloud-dashboard · pr-comments · teams-rollups ·
                 public-web · activation-flow
  shared/        schemas · redaction · constants · utils · test-fixtures
```

**THE ONE RULE (ownership invariant):** No capability, skill, router, adapter, or surface may create
its own **policy engine · evidence model · receipt writer · approval logic · dashboard schema ·
readiness gate · state store**. Those are **Kernel-owned singletons**. Everything else *calls* them.
This directly prevents the old repo's failure of 15+ proof systems / 20+ gates / source-of-truth drift.

---

## 2. Ownership table (who owns what)

| Concern | Owner (Kernel module) | Everyone else |
|---|---|---|
| Policy (what is allowed/blocked/needs-approval) | `kernel/policy` (Policy Matrix) | read-only via Policy Router |
| Session/work state | `kernel/state-ledger` (event-sourced) | append events only |
| Evidence (what counts as proof) | `kernel/evidence` (Evidence Router + levels) | submit evidence, never grade it |
| Receipts (durable outcome record) | `kernel/receipts` (Receipt Writer + redaction) | request a receipt; never format their own |
| Approval (human-in-the-loop) | `kernel/approval` | request approval; never self-authorize |
| Stop vs Continue | `kernel/stop-continue-gate` | provide signals; never decide READY |
| Routing | `kernel/routing` + `routers/*` | declare needs; never hardcode routes |
| Runtime boundary (fs/net/secret) | `kernel/runtime-boundary` | act only through it |
| Cloud sync boundary | `kernel/sync-boundary` | hand sanitized payloads only |
| Dashboard payload schema | `kernel/receipts` + `shared/schemas` | surfaces render, never define |
| Security invariants | `kernel/*` (cross-cutting, see Phase 9) | cannot weaken |

---

## 3. Kernel contracts (the public API every capability uses)

1. **Work Contract** — the bounded unit of intent. Fields: `objective`, `allowedPaths`,
   `requestedOutputs`, `successCriteria`, `stopConditions`, `evidenceRefs`, `reviewReasons`,
   `planTier`. (Mined conceptually from old `src/wuz-project-contract/contract-types.ts` — rewritten clean.)
2. **State/Event Ledger** — append-only event log (ADR-1). Every decision is an event; state is a fold.
3. **Evidence Router** — grades evidence at 4 levels: **NAVIGATION → INTERACTION → OUTCOME →
   POST_ACTION**. READY requires OUTCOME + POST_ACTION, never just NAVIGATION (kills "no-404 = proof").
4. **Policy Matrix** — deterministic `{allow | block | needs_approval}` per action class; LLM output
   can never override it (ADR-4).
5. **Stop/Continue Gate** — consumes evidence + policy + reviewer verdicts → `{CONTINUE | STOP_BLOCKED
   | STOP_DONE}` + `safeNextActions[]`. Never emits READY without OUTCOME+POST_ACTION proof.
6. **Approval** — compact, typed approval requests for external/destructive/security-sensitive actions.
7. **Receipt Writer** — the *only* writer of durable receipts; always routes through `shared/redaction`.
8. **Runtime Boundary** — mediates filesystem/network/secret access; denies raw-secret reads to
   LLM/cloud regardless of platform sandbox (the verified Claude Code sandbox is *not* an isolation boundary).
9. **Sync Boundary** — the only path to cloud; emits sanitized metadata only.

---

## 4. Major architecture decisions (ADRs)

### ADR-1 — Event-sourced Kernel state
- **Decision:** Kernel state is an append-only event ledger; current state is a deterministic fold.
- **Options:** (a) mutable in-memory/JSON blobs (old repo style); (b) event-sourced ledger; (c) external DB.
- **Chosen:** (b). **Rejected:** (a) drifts & can't replay; (c) breaks local-first/no-signup.
- **Serves product:** replay, pause/resume, crash recovery, honest history → trustworthy proof.
- **Old failure prevented:** source-of-truth drift; `cco-status` 9940-line dumps (state was unstructured).
- **Reviewer:** architecture-review (lead-applied design critique; live `plan-eng-review` recommended pre-impl).
- **External support:** **VERIFIED** OpenHands SDK (MIT) — event-sourcing cut system failures ~61% (78→30/1k), persist 0.20ms, replay 4.1ms, recovery <20ms (`arxiv 2511.03690`).
- **Security/privacy:** events redacted at write; no raw secrets/prompts. **Perf:** sub-ms per event.
- **Dogfood/test:** replay a session deterministically; crash mid-session and recover. **First slice:** YES — the slice's state-ledger.

### ADR-2 — Deterministic gates via hooks; memory is context, not enforcement
- **Decision:** Anything that must hold (block secret, block fake-READY) is a deterministic Kernel
  gate wired as a Claude Code **hook**; CLAUDE.md/skill text is treated as context only.
- **Chosen over** "instruct the model to behave" (old repo's prompt-only reviewers).
- **Serves product:** guarantees, not hopes. **Old failure prevented:** "skills/reviewers were prompt-only, not enforcement"; guards that "warned but didn't block."
- **External support:** **VERIFIED** Claude Code — "treated as context, not enforced configuration … to block an action, use a PreToolUse hook"; hooks "tighten but not loosen"; **avoid the `ask`→deny bypass bug #39344** (use explicit `deny`/exit-2). **First slice:** YES — stop/continue gate as a hook.

### ADR-3 — Evidence has levels; READY needs OUTCOME + POST_ACTION
- **Decision:** Evidence Router grades NAVIGATION/INTERACTION/OUTCOME/POST_ACTION; READY requires the top two.
- **Rejected:** treating a 200/no-404, a redirect, or "tests exist" as completion.
- **Old failure prevented:** "no-404 accepted as proof"; "checkout redirect = payment completion."
- **Reviewer:** production-confidence (`gstack-review`/`gstack-qa` live, later). **First slice:** YES — the fake-READY-blocked test asserts this.

### ADR-4 — Deterministic policy is supreme over model output
- **Decision:** No model/skill output can flip a `block`/`needs_approval` to `allow`.
- **Serves product:** safety floor independent of model behavior. **External support:** Claude Code hooks-tighten-not-loosen + permission precedence (VERIFIED).
- **Security:** core invariant (Phase 9). **First slice:** YES — policy check precedes execution.

### ADR-5 — Local-first; cloud is an optional sanitized mirror
- **Decision:** All core value works locally with no signup; cloud sync (claim) is optional and
  carries **sanitized metadata only** (no raw secrets/prompts/logs/source/transcripts).
- **Rejected:** dashboard-first / cloud-first architecture.
- **Old failure prevented:** scope creep to platform/cloud over local control. **First slice:** local receipt only; sync stubbed off.

### ADR-6 — Governed, trust-tiered skills; nothing loads by default
- **Decision:** Skills pass an intake (provenance → license → security scan → marginal-utility eval →
  trust tier T0–T3) before they can load; external skills are T3/untrusted by default; no
  all-skills-in-every-prompt.
- **External support:** **VERIFIED** Claude Code "a skill can grant itself broad tool access" + progressive disclosure; SWE-Skills-Bench specifics **UNVERIFIED/RETRACTED** so "more-skills-hurt" is a *hypothesis to measure*, not a cited fact. **First slice:** governance defined, enforcement stubbed.

### ADR-7 — Routers are deterministic and cheap (LLM out of the control path where possible)
- **Decision:** Capability/Skill/Context/Tool/Model/Approval/Evidence routers use deterministic
  rules + budgets; the LLM is used for work, not for routing/policy.
- **Serves product:** predictable latency/cost; reproducible gates. **First slice:** minimal capability+evidence routing only.

### ADR-8 — One canonical name: `avorelo`
- **Decision:** Single name end-to-end; no `cco`/`wuz`. Naming/migration policy precedes any future rename of old assets.
- **Old failure prevented:** 3-way naming drift.

---

## 5. Data-flow (canonical spine — every capability follows this)

```
intent
 → Work Contract (kernel/work-contract)
 → Capability Router → Context Router → Skill Router → Tool/Model/Adapter Routers
 → safe execution (adapters, via runtime-boundary)
 → evidence submitted → Evidence Router grades (NAV/INT/OUT/POST)
 → Policy Matrix + reviewer verdicts → Stop/Continue Gate
 → decision {CONTINUE | STOP_BLOCKED | STOP_DONE} (+ safeNextActions, or autonomous next instruction)
 → Receipt Writer (redacted) → State Ledger event → Measurement
 → Surface render (CLI/local dashboard) → optional Sync Boundary → cloud (sanitized)
```

---

## 6. Plan tiers (boundary, detailed in Phase 11/14)
- **Free:** local kernel, Work Contracts, deterministic gates, local receipts/dashboard, secret block, fake-READY block.
- **Pro:** autonomous iteration depth, browser/visual proof, payment-readiness, richer remediation, optional cloud claim.
- **Teams:** governed exposure, teams rollups (sanitized), role/approval governance.
No tier paywalls *basic truth, basic usability, or basic recovery* (global rule).

---

## 7. Skill Review (this phase)
| Reviewer | Category | Verdict | Basis / evidence |
|---|---|---|---|
| architecture-review | existing on-disk `plan-eng-review` | PARTIAL (lead-applied; live run recommended pre-impl) | requires repo+toolchain; deferred per honesty rule |
| external-reference-review | harness-native `deep-research` | GO | verified core (`02-...md`, evidence JSON) |
| source-of-truth-review | NEEDS_AVORELO_NATIVE_SKILL | GO (design) | THE ONE RULE + event ledger remove drift surfaces |
| security-review | existing `cso` / native | PARTIAL | invariants set; full pass in Phase 9 (2nd research running) |

*No skill is claimed to have "run" that did not. `deep-research` genuinely ran.*

## 8. Old-repo classification (this phase)
Preserve-concept: Work Contract, Evidence levels, Receipt+redaction, gate/guard `safeNextActions`,
ledger. Rewrite-clean: all of the above (no code copied). Do-not-copy: Wasp app, `cco/wuz` naming,
multiple proof systems. Anti-pattern-avoided: per-feature gates/proof (killed by THE ONE RULE).

## 9. Risks / open questions
- Kernel must stay *small* or it becomes the old monolith — enforce via capability/surface ownership tests.
- Skill-governance security basis pending 2nd `deep-research` (Phase 9).
- Router determinism vs flexibility — validate with perf budgets (Phase 12).

---

### Decision: `CANONICAL_ARCHITECTURE_GO`
A small Kernel owns policy/state/evidence/receipts/approval/routing; capabilities/skills/routers/
adapters/surfaces compose it and own nothing of their own. Enforced by THE ONE RULE and 8 ADRs, each
tied to a verified external pattern and a specific old-repo failure it prevents.
