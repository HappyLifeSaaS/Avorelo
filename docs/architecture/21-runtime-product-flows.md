# 21 — Runtime Product Flows (Phase 6)

**Status:** COMPLETE (lead-authored design; planning only — no `src/avorelo` code written)
**Decision:** `RUNTIME_FLOWS_GO`
**Date:** 2026-06-08
**Subordinate to:** `architecture/20-canonical-architecture.md` (the spine) and `product/10-product-model.md`.
This doc expands the spine's data-flow (§5 of doc 20) into concrete runtime flows; it may not contradict
the spine. Anything unspecified is listed under **Risks / open questions**, not invented.

---

## Purpose

Show, end to end, how every runtime event in Avorelo travels the canonical spine
(`intent → Work Contract → routers → capabilities → adapters → evidence → Evidence Router → Policy +
reviewer verdicts → Stop/Continue Gate → decision → Receipt → State event → Measurement → Surface →
optional Sync Boundary`). Each lifecycle hook is mapped to **VERIFIED Claude Code hook semantics**:
hooks are deterministic enforcement, instructions/memory are context-not-enforcement, hooks **tighten
but never loosen**, and `PreToolUse` is the one deterministic **block point** before a tool runs
(ADR-2, doc 20 §4). The aim is that an implementer can read one subsection and know exactly which
Kernel singleton owns each step — never re-implementing policy, evidence, receipts, or gates
(THE ONE RULE).

---

## Flow notation

Every flow below is written as one chain:

```
user action
 → Work Contract (kernel/work-contract; or read existing)
 → routers (capability · context · skill · tool · model · approval · evidence)
 → capabilities (feature logic; owns no policy/proof)
 → adapters (claude-code · git · browser · local-env · ci-cd · vercel/netlify · filesystem, via runtime-boundary)
 → evidence (submitted, never self-graded) → Evidence Router grades NAV/INT/OUT/POST
 → decision (Policy Matrix + reviewer verdicts → Stop/Continue Gate → {CONTINUE | STOP_BLOCKED | STOP_DONE})
 → output/surface (CLI · local-dashboard · pr-comments · teams-rollups · activation-flow)
 → receipt/measurement (Receipt Writer via shared/redaction → State Ledger event → Measurement)
```

Notation conventions: **[K]** = Kernel-owned singleton (never re-implemented); **[hook]** = wired as a
Claude Code hook (deterministic); **[approval]** = compact typed approval request; **[redact]** = passes
through `shared/redaction`. "Evidence levels" = NAVIGATION → INTERACTION → OUTCOME → POST_ACTION; READY
requires OUTCOME + POST_ACTION.

---

### Flow: first install / activation

- **User action:** `npx avorelo@latest activate` (per product model §3).
- **Work Contract:** a bootstrap contract `{objective: "activate avorelo locally", allowedPaths:
  [repo/.claude, repo/.avorelo], requestedOutputs: [hooks-installed, doctor-pass, first-receipt],
  successCriteria: [hooks validated, ledger initialized], planTier: Free}`.
- **Routers:** Capability Router → `activation` capability; Context Router loads minimal context (no
  skills loaded — ADR-6 nothing-by-default); Approval Router flags the hook-install as a
  filesystem-mutating action **[approval]** scoped to `.claude/`.
- **Capabilities:** `activation` capability orchestrates install; calls Runtime Boundary for all writes.
- **Adapters:** `claude-code` adapter writes hook config; `local-env` adapter records toolchain;
  `filesystem` adapter (via runtime-boundary) creates `.avorelo/` ledger store.
- **Evidence:** post-install `doctor` run produces OUTCOME (hooks present + parse) + POST_ACTION (a
  dry-run event replays from the ledger). Graded by Evidence Router **[K]**.
- **Decision:** Stop/Continue Gate **[K]** → `STOP_DONE` only if doctor reaches OUTCOME+POST_ACTION;
  else `STOP_BLOCKED` with `safeNextActions` (e.g. "re-run doctor", "fix hook path").
- **Output/surface:** `activation-flow` + CLI print the readiness summary; no cloud touched.
- **Receipt/measurement:** Receipt Writer **[K]** **[redact]** writes the activation receipt;
  State Ledger **[K]** records `activated` event; Measurement records install latency.

### Flow: first AI session

- **User action:** founder starts a coding session (Claude Code) inside an avorelo-activated repo.
- **Work Contract:** founder's intent is captured into a Work Contract before tools run (objective,
  allowedPaths, successCriteria, stopConditions, planTier). No contract → scope-repair prompts for one.
- **Routers:** Capability Router picks the feature; Context Router sets the **context budget [K-routing]**
  and selects the minimum-correct context; Skill Router loads **only** governed, trust-tiered reviewers
  that the contract's `reviewReasons` justify (ADR-6); Model/Tool/Adapter Routers pick cheapest correct.
- **Capabilities:** the targeted capability runs the loop; owns no policy/proof.
- **Adapters:** `claude-code` adapter is the primary execution adapter; others on demand.
- **Evidence / decision / surface / receipt:** as the session proceeds, each tool call passes the
  PreToolUse → PostToolUse → Stop/Continue chain below; a session-open receipt anchors the ledger.

### Flow: pre-prompt / pre-context

- **User action:** session/turn begins; context is about to be assembled (maps to Claude Code
  `SessionStart` / pre-context assembly — VERIFIED hook surface) **[hook]**.
- **Work Contract:** loaded/created; `allowedPaths`, `planTier`, `contextBudget` read.
- **Routers:** Context Router enforces the **token/context budget** (the `context-hygiene-review`
  native gate, doc 03 #11) and selects sources; Skill Router resolves which reviewers may attach.
- **Capabilities:** `source-of-truth` capability runs a freshness check (docs↔code↔spec) and
  `secret` pre-scan capability scans the candidate context for secret patterns.
- **Adapters:** `filesystem` (read-only via runtime-boundary), `git` (HEAD/dirty state).
- **Evidence:** freshness diff + secret-scan result submitted to Evidence Router.
- **Decision:** Policy Matrix **[K]** — if drift or a secret would enter context, `block`
  (see *source-of-truth drift* and *secret exposure* flows). Otherwise `allow` and proceed.
- **Output/surface:** silent on success; CLI/dashboard note on block.
- **Receipt/measurement:** context-budget actual-vs-cap measured; block events recorded as ledger events.

### Flow: UserPromptSubmit

- **User action:** user submits a prompt (maps to Claude Code `UserPromptSubmit` hook — VERIFIED) **[hook]**.
- **Work Contract:** the prompt is reconciled against the active contract's `objective`/`allowedPaths`;
  a prompt that implies new scope triggers **scope-repair** (clarify or amend contract) rather than silent drift.
- **Routers:** Capability/Skill/Context routers re-resolve if the prompt changes the needed capability.
- **Capabilities:** `scope-repair` and `secret` pre-scan inspect the prompt text.
- **Adapters:** none yet (no tool has run).
- **Evidence / decision:** Policy Matrix **[K]** may `block` (prompt tries to override policy, requests
  raw secret, or pushes out-of-scope) or pass; this is a **context/intent** gate, *not* the tool block
  point. The model's response can never flip a `block` to `allow` (ADR-4).
- **Output/surface:** CLI inline note if scope-repair or block fires.
- **Receipt/measurement:** prompt-scope decision recorded as a ledger event (prompt text **[redact]**).

### Flow: PreToolUse

- **User action:** the agent is about to invoke a tool (edit, bash, web-fetch, deploy) — Claude Code
  `PreToolUse` hook, the **VERIFIED deterministic block point** **[hook]**.
- **Work Contract:** the requested tool action is checked against `allowedPaths`, `stopConditions`,
  `planTier`, and the action class.
- **Routers:** Tool Router + Approval Router classify the action {benign | external | destructive |
  security-sensitive}.
- **Capabilities:** the calling capability supplies the proposed action; owns no verdict.
- **Adapters:** target adapter is **not** yet executed — this gate precedes it.
- **Evidence:** N/A (pre-execution); the *inputs* (paths, command, URL) are the evidence for the gate.
- **Decision:** **Policy Matrix [K] is supreme here (ADR-4).** Returns `allow` (proceed), `block`
  (explicit **deny / exit-2**, deliberately avoiding the `ask`→deny bypass bug #39344 — ADR-2), or
  `needs_approval` → emits a compact typed **[approval]** request. Out-of-`allowedPaths` writes, raw
  secret reads, and policy-override attempts are hard `block`. Hooks **tighten, never loosen**.
- **Output/surface:** on `needs_approval`, CLI/dashboard shows the compact approval card; on `block`,
  a reason + `safeNextActions`.
- **Receipt/measurement:** decision recorded as a ledger event; blocks/approvals counted as measurements.

### Flow: PostToolUse

- **User action:** a tool finished (Claude Code `PostToolUse` hook — VERIFIED) **[hook]**.
- **Work Contract:** the result is associated with the contract's `requestedOutputs`.
- **Routers:** Evidence Router is invoked to grade the just-produced artifact.
- **Capabilities:** the capability collects raw outputs (exit codes, diffs, HTTP responses, screenshots)
  and submits them as evidence — it does **not** grade them.
- **Adapters:** `browser` (interaction/screenshot), `git` (diff), `ci-cd` (test result), `filesystem`.
- **Evidence:** submitted; Evidence Router **[K]** assigns a level NAV/INT/OUT/POST. A 200/no-404 is at
  most NAVIGATION and **cannot** alone imply READY (kills "no-404 = proof"); a checkout redirect is
  NAVIGATION/INTERACTION, never OUTCOME (kills "redirect = payment").
- **Decision:** partial — feeds the Stop/Continue Gate; PostToolUse itself records, does not finalize READY.
- **Output/surface:** incremental progress on local dashboard.
- **Receipt/measurement:** tool-result event appended **[redact]**; evidence level recorded.

### Flow: Stop/Continue Gate

- **User action:** the agent signals it wants to stop/turn-complete (Claude Code `Stop` hook — VERIFIED) **[hook]**.
- **Work Contract:** `successCriteria` + `stopConditions` + required evidence levels are the gate's spec.
- **Routers:** Evidence Router supplies graded levels; Skill Router supplies reviewer verdicts
  (e.g. `production-confidence` = `qa`/`review`) where the contract required them.
- **Capabilities:** the capability provides progress signals; never decides READY.
- **Adapters:** none new.
- **Evidence:** the accumulated graded evidence set.
- **Decision:** **Stop/Continue Gate [K]** → `{CONTINUE | STOP_BLOCKED | STOP_DONE}` + `safeNextActions[]`.
  It **never emits READY/STOP_DONE without OUTCOME + POST_ACTION** (ADR-3) and never with a `block`
  outstanding (ADR-4). `CONTINUE` issues the autonomous next instruction (see *autonomous iteration*).
- **Output/surface:** decision + safe next actions on CLI/local dashboard; on Pro, may attach
  browser/visual proof.
- **Receipt/measurement:** the decision is the primary durable receipt **[redact]**; ledger `decided` event.

### Flow: SessionEnd

- **User action:** session ends (Claude Code `SessionEnd` hook — VERIFIED) **[hook]**.
- **Work Contract:** contract closed/parked; unmet `successCriteria` carried as open `safeNextActions`.
- **Routers:** none new; Sync Boundary considered only if `claim` is enabled.
- **Capabilities:** `session-collision`/cleanup capability checks for stale processes / dirty worktree
  (see that flow) and finalizes state.
- **Adapters:** `git` (final dirty/branch state), `local-env` (process cleanup), `filesystem`.
- **Evidence:** final session summary (counts of blocks/approvals/continues, terminal evidence levels).
- **Decision:** Stop/Continue Gate produces a session-level `STOP_DONE`/`STOP_BLOCKED` rollup; never
  upgrades an unproven session to READY.
- **Output/surface:** session summary on CLI + local dashboard update.
- **Receipt/measurement:** session-close receipt **[redact]**; Measurement records session totals;
  optional Sync Boundary emits sanitized rollup only if claimed.

### Flow: receipt writing

- **Trigger:** any decision/outcome that must be durable (activation, tool decision, gate decision, session close).
- **Work Contract:** supplies the `objective`/`evidenceRefs` the receipt references.
- **Routers:** Evidence Router level is embedded; no router decides format.
- **Capabilities:** request a receipt; **never format their own** (THE ONE RULE — prevents the old
  repo's 15+ proof systems / single-receipt over-claim).
- **Adapters:** none — receipts are Kernel-internal, then surfaced.
- **Evidence:** the graded evidence set the receipt attests to (OUTCOME/POST_ACTION for READY).
- **Decision:** the receipt records the decision; it cannot manufacture one.
- **Output/surface:** receipts rendered by surfaces (CLI/local dashboard); surfaces never define the schema.
- **Receipt/measurement:** **Receipt Writer [K] is the only durable-receipt writer**, always via
  `shared/redaction` **[redact]** — no raw secrets/prompts/source/transcripts ever land in a receipt.
  Append-only State Ledger event accompanies it.

### Flow: local dashboard update

- **User action:** `avorelo open` (or live refresh) — outcome surface, not the product center.
- **Work Contract:** N/A (read-only view of contracts + receipts).
- **Routers:** none — surfaces only *read* Kernel outputs and *trigger approved* actions.
- **Capabilities:** none own dashboard data.
- **Adapters:** none (reads `.avorelo/` ledger + receipts).
- **Evidence:** displays graded evidence levels and what was blocked/continued.
- **Decision:** none made here; the dashboard *shows* Kernel decisions.
- **Output/surface:** `local-dashboard` renders the Kernel-owned dashboard payload schema
  (`kernel/receipts` + `shared/schemas`); the surface **never defines the schema**.
- **Receipt/measurement:** read-only; no new receipts. A view event may be measured.

### Flow: optional claim / cloud sync

- **User action:** `avorelo claim` then sync (opt-in; ADR-5). Default is fully local.
- **Work Contract:** the claim itself is an action requiring **[approval]** (external surface).
- **Routers:** Approval Router gates the claim; Sync Boundary is the only egress path.
- **Capabilities:** `cloud-claim` capability assembles a payload; cannot bypass Sync Boundary.
- **Adapters:** cloud adapter behind Sync Boundary.
- **Evidence:** the sanitized payload contents are themselves checked against the redaction contract.
- **Decision:** Policy Matrix + Sync Boundary **[K]** — emits **sanitized metadata only**; raw secrets,
  prompts, logs, source, and transcripts are denied regardless of platform sandbox (ADR-5, runtime boundary §8).
- **Output/surface:** `cloud-dashboard` (Pro/Teams) renders sanitized rollups.
- **Receipt/measurement:** sync receipt **[redact]** records *that* a sanitized payload synced, not its raw content.

### Flow: secret exposure

- **User action:** a secret pattern appears in context, prompt, tool input, tool output, or a would-be receipt.
- **Work Contract:** any contract — secret handling is a cross-cutting invariant, not opt-in.
- **Routers:** the secret-scan result routes to Policy Matrix at the relevant lifecycle point
  (pre-context, UserPromptSubmit, PreToolUse, PostToolUse, receipt writing).
- **Capabilities:** `secret` (Secret Guard) capability detects HIGH-tier patterns (e.g. `AKIA…`,
  `ghp_…`, `sk-…`, `xoxb-…`) — *detection only*.
- **Adapters:** Runtime Boundary **[K]** mediates fs/net/secret and **denies raw-secret reads to
  LLM/cloud regardless of platform sandbox** (the verified Claude Code sandbox is not an isolation boundary).
- **Evidence:** the detection event (pattern class + location), never the secret value.
- **Decision:** **hard `block` [K]** before the secret reaches LLM, cloud, logs, or a receipt (ADR-2/4);
  not downgradable by model output. Best wired as a deterministic hook at PreToolUse and at receipt write.
- **Output/surface:** CLI/dashboard show "secret blocked" with location, never the value.
- **Receipt/measurement:** redacted block event **[redact]**; secret value never persisted anywhere.

### Flow: autonomous iteration

- **User action:** none — Stop/Continue Gate returned `CONTINUE` (work incomplete but unblocked).
- **Work Contract:** unchanged; the gate derives the next bounded instruction from unmet
  `successCriteria` + missing evidence levels, within `allowedPaths`/`stopConditions`.
- **Routers:** Context/Tool/Model routers re-resolve for the next step; budgets still enforced.
- **Capabilities:** the capability executes the next step; `remediation` connectors (Pro) may apply
  fixes within scope.
- **Adapters:** as needed (claude-code, browser for visual proof on Pro, etc.).
- **Evidence:** new evidence is graded; the loop targets OUTCOME + POST_ACTION.
- **Decision:** loop returns to Stop/Continue Gate each cycle until `STOP_DONE` (proven) or
  `STOP_BLOCKED` (needs human/approval). Iteration **depth** is a Pro capability; the *safety floor*
  (never fake-READY) is Free.
- **Output/surface:** live progress + each cycle's decision on the dashboard.
- **Receipt/measurement:** each cycle appends a ledger event; iteration count + convergence measured.

### Flow: payment readiness

- **User action:** a flow involving payment/checkout is claimed complete.
- **Work Contract:** `successCriteria` for payment must demand OUTCOME + POST_ACTION explicitly.
- **Routers:** Evidence Router grades; Skill Router may attach `production-confidence` (`qa`/`review`).
- **Capabilities:** `payment-readiness` (Pro) capability drives the proof flow; owns no grading.
- **Adapters:** `browser` adapter performs interaction and captures **POST_ACTION** state (e.g. order
  recorded / confirmation persisted), not merely a redirect.
- **Evidence:** redirect/200 = NAVIGATION/INTERACTION only; a *persisted post-payment state change* is
  the required POST_ACTION.
- **Decision:** Stop/Continue Gate **[K]** refuses READY on redirect/no-404 alone (kills "redirect =
  payment completion"); requires OUTCOME + POST_ACTION (ADR-3).
- **Output/surface:** Pro local dashboard / cloud rollup shows the proven payment path with evidence refs.
- **Receipt/measurement:** payment-readiness receipt **[redact]** cites the POST_ACTION evidence;
  no raw payment data persisted.

### Flow: team rollup

- **User action:** a team lead views governed cross-session status (Teams tier).
- **Work Contract:** N/A for viewing; team *actions* carry role/approval governance.
- **Routers:** Approval Router enforces role/ACL on any privileged team action
  (`teams-governance-review` native gate, doc 03 #17).
- **Capabilities:** `teams-rollup` capability aggregates already-sanitized receipts.
- **Adapters:** cloud adapter behind Sync Boundary (rollups are post-sync).
- **Evidence:** aggregate evidence levels + decisions across sessions (sanitized).
- **Decision:** governance is enforced, not suggested — privileged actions need approval/role; no raw
  cross-tenant data exposure.
- **Output/surface:** `teams-rollups` surface renders sanitized aggregates only.
- **Receipt/measurement:** rollup view + any team action recorded **[redact]**; metrics aggregated, not raw.

### Flow: stale process / dirty worktree

- **User action:** session start/continue/end detects a leftover process or uncommitted/conflicted worktree.
- **Work Contract:** the active contract's `stopConditions` include environment-collision conditions.
- **Routers:** Tool/Approval routers classify any cleanup that mutates state.
- **Capabilities:** `session-collision` capability detects stale PID/lock and dirty/ahead/behind git state.
- **Adapters:** `git` (status/dirty), `local-env` (process inspection), `filesystem` — all via runtime-boundary.
- **Evidence:** the detected collision (process id/lock, git dirty/conflict summary).
- **Decision:** Policy Matrix **[K]** — `block` proceeding into an unsafe environment; offer recovery
  via `safeNextActions` (e.g. "stop stale process", "stash/commit", "resolve conflict"). Destructive
  cleanup requires **[approval]**.
- **Output/surface:** CLI/dashboard collision warning + recovery options (never auto-destroy without approval).
- **Receipt/measurement:** collision + recovery decision recorded as a ledger event.

### Flow: source-of-truth drift

- **User action:** any pre-context/pre-launch check, or scheduled run.
- **Work Contract:** drift detection is a cross-cutting gate, not opt-in.
- **Routers:** Context Router triggers the check before context assembly.
- **Capabilities:** `source-of-truth` capability diffs docs↔code↔spec (the highest-priority
  Avorelo-native gate, doc 03 #14 — it would have caught the old repo's handoff-vs-HEAD drift).
- **Adapters:** `git` (HEAD vs documented state), `filesystem` (docs/spec).
- **Evidence:** the drift diff (which artifacts disagree).
- **Decision:** Policy Matrix **[K]** — `block` READY/launch while drift exists; require reconciliation.
  The event-sourced ledger plus THE ONE RULE remove most drift surfaces structurally (single state store).
- **Output/surface:** CLI/dashboard drift report with the disagreeing artifacts.
- **Receipt/measurement:** drift block event recorded; reconciliation tracked.

### Flow: reviewer / skill routing

- **User action:** a contract's `reviewReasons` (or a lifecycle point) require a governed reviewer.
- **Work Contract:** `reviewReasons` + `planTier` declare *why* a reviewer is needed; nothing loads by default.
- **Routers:** **Skill Router [K-routing]** resolves only the minimum required reviewers and **only if
  they pass intake/trust-tier** (ADR-6): T0 kernel-native / T1 verified-external / T2 reference-only /
  T3 untrusted-default (cannot load). No all-skills-in-every-prompt.
- **Capabilities:** the reviewer runs as a governed reviewer (e.g. `production-confidence` → `qa`/`review`;
  `security-review` → `cso`); it returns a verdict, it does **not** own policy/evidence/receipts.
- **Adapters:** whatever the reviewer needs (browser for `qa`, git/diff for `review`) via runtime-boundary.
- **Evidence:** the reviewer's findings are submitted as evidence/verdict
  `{verdict: GO|NO_GO, blockers[], safeNextActions[], evidenceRefs[], confidence}` — graded/weighed by
  the Kernel, never self-finalizing.
- **Decision:** reviewer verdicts feed the Stop/Continue Gate **[K]**; a `NO_GO` can block READY, but a
  reviewer cannot flip a Policy `block` to `allow` (ADR-4). Loading an external/untrusted skill itself
  requires **[approval]** + governance pass.
- **Output/surface:** verdict surfaced on CLI/dashboard/`pr-comments` as appropriate.
- **Receipt/measurement:** reviewer verdict + basis recorded **[redact]**; marginal-utility measured
  (the "more-skills-hurt" **HYPOTHESIS to measure**, not a cited fact — SWE-Skills-Bench UNVERIFIED).

---

## Old-repo lessons applied

- **No-404 = proof** → killed: PostToolUse grades a 200/no-404 as at most NAVIGATION; READY needs
  OUTCOME + POST_ACTION (payment-readiness flow).
- **Redirect = payment completion** → killed: payment-readiness requires a persisted POST_ACTION state
  change, not a redirect.
- **Warn-don't-block gates** → killed: enforcement lives in deterministic hooks (PreToolUse = explicit
  deny/exit-2, avoiding bug #39344); memory/skill text is context only (ADR-2).
- **15+ proof systems / single-receipt over-claim** → killed: Receipt Writer is the only durable-receipt
  writer; capabilities cannot format their own (THE ONE RULE).
- **20+ gates / drift** → killed: one Stop/Continue Gate, one Policy Matrix, one State Ledger; surfaces
  read, never define schema.
- **Raw secrets anywhere** → killed: Runtime Boundary denies raw-secret reads to LLM/cloud regardless of
  sandbox; redaction on every write.
- **Source-of-truth drift** → killed/structurally reduced: event-sourced single state store + drift gate.
- **Auto-installed/auto-trusted skills** → killed: trust-tiered intake, nothing loads by default, T3 quarantine.
- **Cloud/platform scope creep** → killed: local-first; Sync Boundary is the only egress, sanitized metadata only.
- **Worktree sprawl / stale process** → addressed: `session-collision` flow detects and gates with approved recovery.

Old-repo classification for items referenced here: **preserve-concept** (Work Contract, evidence levels,
gate `safeNextActions`, receipts+redaction, ledger); **rewrite-clean** (all of them — no code copied);
**do-not-copy / anti-pattern** (per-feature gates/proof, multiple proof systems, naming sprawl).

---

## Risks / open questions

- **Exact hook → lifecycle mapping for pre-context.** Claude Code `SessionStart`/`UserPromptSubmit`/
  `PreToolUse`/`PostToolUse`/`Stop`/`SessionEnd` are VERIFIED hook surfaces; the precise binding of the
  *pre-context secret/freshness scan* to `SessionStart` vs a `UserPromptSubmit` pre-pass is **UNVERIFIED**
  in current docs and must be confirmed against the live hook API during implementation.
- **PreToolUse coverage of every tool.** Whether all execution paths (incl. subagent and MCP tool calls)
  reliably route through `PreToolUse` needs verification; if any path bypasses it, the block point leaks
  (must fail-closed). **UNVERIFIED** until tested.
- **Autonomous-iteration depth vs cost** is a Pro boundary; per-cycle budget enforcement (Context Router)
  needs perf validation (Phase 12).
- **Reviewer routing reproducibility:** gstack skills self-update; pinning is unresolved (doc 03 open Q3) —
  non-pinned reviewers threaten reproducible gates.
- **Team rollup tenancy isolation** (cross-tenant leakage prevention) is specified at design level only;
  full security pass is Phase 9.
- **Marginal-utility / "more-skills-hurt"** remains a **HYPOTHESIS to measure**, not a cited fact
  (SWE-Skills-Bench arxiv 2603.15401 UNVERIFIED/RETRACTED).

---

## Skill Review (this doc)

| Reviewer | Category | Verdict | Basis |
|---|---|---|---|
| architecture-review (`plan-eng-review`) | existing-on-disk | PARTIAL | lead-applied design critique of flow↔spine consistency; live interactive run recommended pre-impl (needs repo+toolchain) — not claimed to have run |
| external-reference-review (`deep-research`) | harness-native | GO | rests on the `deep-research` run that produced doc 02 (Claude Code hook semantics, OpenHands SDK); this doc cites only VERIFIED anchors, marks the rest UNVERIFIED |
| source-of-truth-review | avorelo-native-to-build | GO (design) | flows reuse single Kernel singletons (THE ONE RULE) + event ledger; no per-flow proof/gate invented — `NEEDS_AVORELO_NATIVE_SKILL` to enforce |
| security-review (`cso` / built-in) | existing / harness-native | PARTIAL | secret-exposure, sync-boundary, PreToolUse-block invariants set at design level; full audit deferred to Phase 9 (no `src/` code yet) |
| production-confidence (`qa` / `review`) | existing-on-disk | PARTIAL (design) | referenced as the reviewer that gates READY in payment/iteration flows; runs live once an app exists |

*No gstack skill is claimed to have "run" for this doc. `deep-research` genuinely ran (doc 02); the others
are lead-applied design critique or `NEEDS_AVORELO_NATIVE_SKILL`.*

---

### Decision: `RUNTIME_FLOWS_GO`
