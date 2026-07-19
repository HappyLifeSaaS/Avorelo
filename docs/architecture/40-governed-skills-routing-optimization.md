# 40 — Governed Skills, Routing & Optimization (Phase 8)

**Status:** DESIGN / PLANNING ONLY (no `src/avorelo/**` code; nothing migrated/copied)
**Decision:** `SKILLS_ROUTING_GO` (see end)
**Date:** 2026-06-08
**Authority basis:** `docs/architecture/20-canonical-architecture.md` (canonical spine, `CANONICAL_ARCHITECTURE_GO`)
+ VERIFIED Claude Code docs / OpenHands SDK anchors. This doc expands the spine; it may not contradict it.
Any gap is recorded under **Risks / open questions**, not resolved by inventing architecture.

---

## Purpose

Specify the **routing layer** and the **governed-skill model** that sit between intent and safe
execution, per ADR-6 (governed trust-tiered skills) and ADR-7 (routers deterministic + cheap, LLM out
of the control path). Concretely this doc:

1. Defines the seven Kernel routers (Capability, Skill, Context, Tool, Model, Approval, Evidence) as
   **deterministic functions** with explicit I/O, decision criteria, failure modes, perf budgets,
   required tests, and a dogfood scenario each.
2. Defines the **internal skill manifest** every skill must carry before it can load.
3. Defines the **skill intake pipeline** (provenance → license → security scan → marginal-utility eval
   → trust tier).
4. Records the incorporated lessons and the **measurable** "more-skills-hurt" hypothesis.

**Binding constraint (THE ONE RULE):** routers and skills own **no** policy engine, evidence model,
receipt writer, approval logic, dashboard schema, readiness gate, or state store. They *call* the
Kernel singletons (`kernel/policy`, `kernel/evidence`, `kernel/receipts`, `kernel/approval`,
`kernel/stop-continue-gate`, `kernel/state-ledger`, `kernel/runtime-boundary`, `kernel/sync-boundary`).
A skill verdict is **input** to the Stop/Continue Gate, never a substitute for it.

---

## Routers

All routers live under `src/avorelo/routers/*` (to be built post-gate-3) and obey ADR-7: deterministic
rules + budgets, no LLM in the decision path. "Cheap" target unless noted: **sub-millisecond, p99 < 5ms**,
no network, no model call. Every router emits a **State Ledger event** describing its decision (so routing
is replayable, ADR-1) and never writes a receipt itself.

### Capability Router

- **Input:** a Work Contract `{objective, allowedPaths, requestedOutputs, successCriteria, stopConditions, planTier, reviewReasons}`.
- **Output:** the selected capability id + its declared needs (context kinds, candidate skills, required adapters), or `NO_CAPABILITY`.
- **Decision criteria (deterministic):** match `requestedOutputs`/objective verbs against a static
  capability registry (declared `provides`/`triggers`); break ties by most-specific match, then by
  `planTier` eligibility. No model call.
- **Failure modes:** ambiguous match (two equally specific) → `STOP_BLOCKED` with `safeNextActions` asking
  the user to disambiguate; capability gated above current `planTier` → typed upgrade-needed result (never paywall basic truth/recovery).
- **Performance budget:** sub-ms; pure registry lookup.
- **Tests required:** unambiguous-match selects exactly one; ambiguous-match blocks (does not guess);
  above-tier request yields upgrade-needed not silent drop; unknown objective → `NO_CAPABILITY`.
- **Dogfood scenario:** contract `objective:"prove the checkout page actually charges"` routes to the
  payment-readiness capability (Pro), not a generic "open URL" capability.

### Skill Router

- **Input:** selected capability + its `reviewReasons` + current trust-tier policy + the skill registry (manifests).
- **Output:** an **ordered, minimal** set of skills to load (often empty), each with its trust tier; or none.
- **Decision criteria (deterministic):** load a skill **only if** its manifest `routing trigger` matches a
  present `reviewReason`/signal **and** its `trust tier` is permitted for this action class **and** marginal
  -utility flag is positive. Default is **load nothing** (ADR-6: "nothing loads by default; no
  all-skills-in-every-prompt"). T3/untrusted never auto-load.
- **Failure modes:** trigger matches but tier forbidden → skill excluded, reason logged; no trigger →
  empty set (correct, not an error); manifest missing required fields → skill is **ineligible** (fail-closed).
- **Performance budget:** sub-ms; set intersection over indexed triggers.
- **Tests required:** no-signal → empty set; T3 skill never auto-loads; tier-forbidden skill excluded with
  logged reason; ordering is deterministic for a fixed signal set; malformed manifest excluded.
- **Dogfood scenario:** a contract with `reviewReason:"security-sensitive"` loads the T0 kernel-native
  security reviewer only; it does **not** also load design/QA skills "just in case."

### Context Router

- **Input:** selected capability + skills + Work Contract `allowedPaths`.
- **Output:** the **minimal** context bundle to assemble (files, prior receipts, relevant ledger slice, skill bodies).
- **Decision criteria (deterministic):** include context only when a declared `required input` demands it
  and it is within `allowedPaths`; apply `shared/redaction` before anything leaves the runtime boundary;
  enforce a token/byte budget by dropping lowest-priority items first (progressive disclosure, matching the
  VERIFIED Claude Code skill-disclosure model — REFERENCE_ONLY behavior).
- **Failure modes:** requested context outside `allowedPaths` → denied via `kernel/runtime-boundary`
  (not silently included); budget exceeded → drop-by-priority, never truncate mid-secret; raw secret
  encountered → blocked at boundary regardless of platform sandbox (ADR ref: runtime boundary contract).
- **Performance budget:** cheap; bounded by I/O of the selected files only (no repo-wide scan in the hot path).
- **Tests required:** out-of-`allowedPaths` file excluded; budget overflow drops lowest priority and stays
  coherent; redaction applied before assembly; no raw secret reaches the bundle.
- **Dogfood scenario:** a fix scoped to `allowedPaths:["src/checkout/**"]` assembles only those files +
  the last payment receipt, not the whole tree; an `.env` under that path is redacted, not embedded.

### Tool Router

- **Input:** capability/skill `allowed actions` + Policy Matrix verdict for each action class + adapter availability.
- **Output:** the concrete tool/adapter call(s) permitted for this step, or a Policy block / approval request.
- **Decision criteria (deterministic):** an action runs **only if** Policy Matrix returns `allow`; if
  `needs_approval`, emit a typed Approval request (never self-authorize); if `block`, stop. Tool choice is a
  static map from action class → adapter (`claude-code`/`codex`/`cursor`/`generic-cli`/`github`/`vercel`/
  `netlify`/`local-env`/`ci-cd`/`browser`/`filesystem`). Model output can never flip a verdict (ADR-4).
- **Failure modes:** required adapter unavailable → `STOP_BLOCKED` + `safeNextActions`; destructive/external
  action → `needs_approval` path (avoids the `ask`→deny bypass bug #39344 by routing to explicit
  deny/exit-2 semantics per ADR-2); skill requests an action absent from its `allowed actions` → denied.
- **Performance budget:** cheap; Policy lookup is a deterministic matrix read.
- **Tests required:** `block` action never dispatched; `needs_approval` produces an Approval request and
  halts until resolved; out-of-manifest action denied; model "please allow" text cannot override Policy.
- **Dogfood scenario:** a skill that proposes `git push --force` hits `needs_approval`; without approval the
  Tool Router refuses and the gate returns `STOP_BLOCKED`.

### Model Router

- **Input:** step kind (work vs. cheap utility) + `planTier` + cost/latency budget. (NOTE: routers never use a model to route.)
- **Output:** the model/profile for the **work** step (LLM does the work, not the routing).
- **Decision criteria (deterministic):** static policy table mapping step kind + tier → model profile
  (e.g., deeper reasoning for Pro autonomous iteration, cheaper default for utility passes). Multi-LLM
  selection is **ADAPTed** from the VERIFIED OpenHands SDK multi-LLM routing pattern (MIT, arxiv 2511.03690).
- **Failure modes:** configured model unavailable → deterministic fallback profile + logged event; budget
  exhausted → `STOP_BLOCKED` (never silently downgrade proof quality on a readiness step).
- **Performance budget:** sub-ms table lookup (excludes the model call itself, which is the work).
- **Tests required:** same step + tier → same profile (determinism); unavailable model → documented
  fallback; budget exhaustion blocks rather than degrades a readiness check.
- **Dogfood scenario:** a Free-tier lint pass routes to the cheap profile; a Pro payment-readiness proof
  step routes to the deeper profile.

### Approval Router

- **Input:** a Policy `needs_approval` verdict + the proposed action's typed descriptor.
- **Output:** a compact, typed Approval request to the user surface; on response, an authorize/deny token consumed by the Tool Router.
- **Decision criteria (deterministic):** approval is **required and sufficient only** for the exact action
  class/scope described; scope is least-privilege; one approval never blanket-authorizes a category. Uses
  `kernel/approval` (the singleton) — the router only *shapes and routes* the request.
- **Failure modes:** no response → action stays blocked (fail-closed); approval scope mismatch (action drifts
  from what was approved) → re-prompt; attempted reuse of a consumed token → denied.
- **Performance budget:** cheap to build the request; wall-clock is human latency (out of perf budget).
- **Tests required:** approval authorizes only the described scope; consumed token cannot be reused; timeout/no
  -response leaves action blocked; drifted action re-prompts.
- **Dogfood scenario:** "deploy to Vercel prod" is approved; the same token will **not** silently authorize a
  later "delete project" action.

### Evidence Router

- **Input:** raw evidence artifacts submitted by adapters (HTTP results, DOM/browser observations, command
  output, screenshots-as-refs) for a step.
- **Output:** a graded evidence level per artifact — **NAVIGATION → INTERACTION → OUTCOME → POST_ACTION** — and an aggregate readiness signal.
- **Decision criteria (deterministic):** classify by artifact shape against fixed rules; **READY requires
  OUTCOME + POST_ACTION** (ADR-3). A 200/no-404 is at most NAVIGATION; a checkout redirect is NOT payment
  completion (kills "no-404 = proof" and "redirect = payment"). The router **grades**; it never decides
  READY (that is the Stop/Continue Gate).
- **Failure modes:** missing POST_ACTION on a readiness claim → cannot reach READY (returns the partial
  grade); fixtures/mocks submitted as proof → graded as non-OUTCOME and rejected for readiness; ambiguous
  artifact → graded down, never up.
- **Performance budget:** cheap per artifact; bounded by artifact size, no model call.
- **Tests required:** no-404 alone never grades OUTCOME; redirect alone never grades POST_ACTION; OUTCOME+
  POST_ACTION present → eligible-for-READY signal; fixture-as-proof rejected.
- **Dogfood scenario:** payment flow submits (a) charge-API success (OUTCOME) + (b) ledger/webhook
  confirmation (POST_ACTION) → eligible; a bare 302 redirect alone → not eligible, gate stays `CONTINUE`/`STOP_BLOCKED`.

---

## Internal skill model (the manifest every skill must carry)

Every skill — kernel-native, harness-native, avorelo-native-to-build, or external-reference — must ship a
**typed manifest** (schema in `shared/schemas`, validated at intake). A skill missing any required field is
**ineligible to load** (fail-closed). Fields:

| Field | Meaning / rule |
|---|---|
| **purpose** | One-line what-it-reviews/does. |
| **when-to-use** | Signals/`reviewReasons` that should route to it. |
| **when-not** | Explicit non-triggers (prevents over-loading). |
| **routing trigger** | The exact deterministic signal the Skill Router keys on. |
| **required inputs** | Context kinds it needs (drives Context Router; must be within `allowedPaths`). |
| **forbidden inputs** | Inputs it must never receive (e.g., raw secrets, full transcripts). |
| **allowed actions** | Closed list of action classes it may request (enforced by Tool Router). |
| **blocked actions** | Explicit denylist; cannot be widened by skill text. |
| **evidence required** | What evidence its verdict depends on (graded by Evidence Router, never self-graded). |
| **policy constraints** | Policy classes that gate it; it can only *call* `kernel/policy`. |
| **privacy/security constraints** | Redaction + runtime-boundary obligations; no raw secret reads. |
| **output format** | Typed verdict shape consumed by the Stop/Continue Gate (a verdict, never a READY decision). |
| **tests/evals** | The eval set proving it helps on matched cases and is harmless on mismatched ones. |
| **failure modes** | Known ways it errs; how the Gate degrades safely when it does. |
| **plan-tier relevance** | Free / Pro / Teams applicability (no basic-truth paywall). |
| **performance budget** | Token/latency ceiling; overhead is **measured**, not assumed. |
| **trust tier** | T0 kernel-native / T1 verified-external / T2 reference-only / T3 untrusted-default. |
| **provenance** | Origin, author, license, source URL/commit, intake date. |

**Invariant:** the manifest is **declaration only**. Enforcement lives in the Kernel + routers. Skill text
(like CLAUDE.md/memory) is **context, not enforcement** — the VERIFIED Claude Code model (ADR-2). A skill
can *request*; the Policy Matrix, runtime boundary, and Gate decide.

---

## Skill intake pipeline (provenance → license → security scan → marginal-utility eval → trust tier)

A skill cannot be registered (and therefore cannot be routed/loaded) until it passes, in order:

1. **Provenance** — record origin/author/source ref/intake date. Unknown provenance → defaults to **T3
   untrusted**. (Anti-pattern avoided: auto-installed/auto-trusted skills.)
2. **License** — must be present and compatible; unlicensed/incompatible → reject at intake (no
   mine-later). Mirrors the canonical "verified-MIT" handling of adapted sources (e.g., OpenHands SDK).
3. **Security scan** — inspect declared `allowed/blocked actions`, requested tool access, and body for
   secret-exfil / broad-tool-grab patterns. The VERIFIED Claude Code note that "a skill can grant itself
   broad tool access" makes this mandatory; anything that tries to self-grant beyond its `allowed actions`
   is rejected or pinned to T3. (Deep skill-security claims from external sources remain **UNVERIFIED**
   pending the Phase 9 second research pass; treat as hypotheses, not facts.)
4. **Marginal-utility eval** — run the skill's `tests/evals`: does it improve outcomes on **matched**
   cases without harming **mismatched** cases, within its perf budget? This operationalizes the
   "more-skills-hurt" **hypothesis** (the SWE-Skills-Bench source, `arxiv 2603.15401`, is **RETRACTED/
   UNVERIFIED** — so this is a thing we *measure*, never a thing we *cite*). Net-negative or unmeasured →
   not promoted above T2/reference.
5. **Trust tier assignment** — T0 (kernel-native), T1 (verified-external, passed all gates), T2
   (reference-only, no auto-load), T3 (untrusted default). The Skill Router consults this tier on every
   routing decision; **nothing loads by default** (ADR-6).

Output of intake is a validated manifest + tier recorded as a State Ledger event (replayable). Re-intake is
required on any provenance/license/body change.

---

## Incorporated lessons

- **Skills help only with correct routing.** Value comes from the *right* governed reviewer on a *matched*
  signal — hence the deterministic Skill Router keyed on `routing trigger` + tier, not blanket loading.
- **Mismatch hurts; overhead is measured.** Wrong/extra skills add context cost and noise. The
  marginal-utility eval makes this a **measured** property per skill (perf budget + matched/mismatched
  evals), not an assumption. The "more-skills-hurt" claim is a **hypothesis we test**, because its original
  source is **RETRACTED/UNVERIFIED** — we do not cite it as fact (UNVERIFIED).
- **External skills are untrusted.** External provenance → T3 by default; promotion only via the full
  intake gates. (VERIFIED Claude Code: skills can self-grant broad tool access → must be governed.)
- **No skill bypasses Kernel policy.** A skill emits a typed **verdict** that is *input* to the Stop/
  Continue Gate; it cannot write receipts, grade its own evidence, self-authorize, or flip a Policy verdict
  (ADR-4, THE ONE RULE).
- **No all-skills-in-every-prompt.** Default load set is **empty**; progressive disclosure assembles only
  the minimal bundle (ADR-6; mirrors VERIFIED Claude Code skill progressive-disclosure, REFERENCE_ONLY).

---

## Old-repo lessons applied

Old repo = `ClaudeCode-Optimizer` (**source material only**; no code copied this phase).

- **Anti-pattern → fixed:** prompt-only "skills/reviewers" that warned but didn't block → here a skill is a
  governed *verdict input*; enforcement is the Kernel Gate/Policy (rewrite-clean concept).
- **Anti-pattern → fixed:** auto-installed/auto-trusted skills → intake pipeline + T3-by-default (do-not-copy
  the auto-trust behavior).
- **Anti-pattern → fixed:** 15+ proof systems / 20+ gates / source-of-truth drift → routers/skills own no
  evidence/gate/receipt; single Evidence Router + single Stop/Continue Gate (THE ONE RULE).
- **Anti-pattern → fixed:** no-404 = proof, redirect = payment, fixtures-as-proof → Evidence Router grading
  rules above reject all three for readiness.
- **Preserve-concept (rewrite-clean):** the idea of governed reviewers and evidence levels is mined; the
  manifest + tiered intake is the clean re-expression.

---

## Risks / open questions

- **Router determinism vs. flexibility.** Static registries/matrices may be too rigid for novel intents;
  validate perf + coverage in Phase 12. Open: where (if anywhere) a *bounded* heuristic is acceptable
  without putting an LLM in the control path (ADR-7 currently forbids it).
- **Skill-security basis is partial.** Deep external skill-security claims (Areas 8/9/10) remain
  **UNVERIFIED** pending the Phase 9 second `deep-research` pass; the security-scan rules here are a
  conservative floor, not a complete threat model.
- **"More-skills-hurt" is unmeasured.** We have a hypothesis and an eval design, but no Avorelo data yet;
  the marginal-utility thresholds are placeholders until first dogfood runs.
- **Marginal-utility eval harness.** Needs an avorelo-native eval runner (NEEDS_AVORELO_NATIVE_SKILL); the
  on-disk gstack/anthropic skills are reference-only and were **not run** for this design.
- **Capability registry source of truth.** The 27-capability registry the Capability Router reads is defined
  in `docs/capabilities/*` (Phase 6/7); router tests depend on that registry being stable before gate-3.
- **Approval scoping granularity.** The exact action-class taxonomy for least-privilege approval scopes is
  unspecified here; defer to the Phase 9 security/approval detailing rather than invent it now.

---

## Skill Review

| Reviewer | Category | Verdict | Basis |
|---|---|---|---|
| external-reference-review | harness-native `deep-research` | GO | `deep-research` genuinely ran in prior phases; verified anchors (Claude Code docs, OpenHands SDK MIT `arxiv 2511.03690`) underpin Model Router ADAPT + skill-self-grant risk. |
| routing-architecture-review | avorelo-native-to-build (NEEDS_AVORELO_NATIVE_SKILL) | GO (design) | ADR-7 determinism + THE ONE RULE; reviewed as lead-applied design critique, not an executed skill. |
| skill-governance-review | avorelo-native-to-build (NEEDS_AVORELO_NATIVE_SKILL) | PARTIAL | manifest + intake pipeline defined; deep skill-security claims UNVERIFIED pending Phase 9 2nd research pass. |
| eng-plan-review | existing-on-disk `gstack-plan-eng-review` | PARTIAL (lead-applied; live run recommended pre-impl) | requires repo + toolchain; deferred per honesty rule. Not run — lead-applied design critique only. |
| security-review | existing-on-disk `gstack-cso` | PARTIAL | fail-closed intake + Tool/Approval routing set a floor; full pass in Phase 9. Not run — design critique only. |
| marginal-utility-eval | avorelo-native-to-build (NEEDS_AVORELO_NATIVE_SKILL) | NO_GO (until built) | "more-skills-hurt" source RETRACTED/UNVERIFIED; needs an avorelo-native eval harness + dogfood data before it can gate. |

*No skill is claimed to have "run" that did not. `deep-research` genuinely ran (prior phases). gstack/anthropic
skills here are lead-applied design critique or NEEDS_AVORELO_NATIVE_SKILL.*

### Decision: `SKILLS_ROUTING_GO`
