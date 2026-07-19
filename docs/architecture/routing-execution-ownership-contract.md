# Routing & Execution Ownership Contract

Contract version: `avorelo.routingOwnership.v1`

This document defines the canonical ownership boundaries for Avorelo's routing, execution, approval, and proof architecture. Each layer owns exactly one concern. No layer may duplicate or override another layer's final decision.

## Layer Ownership

### 1. Secret Boundary (`capabilities/secret-boundary/`)

- **Owns:** data safety classification (allow / redact / block)
- **Can:** block execution, redact content, create redacted receipts
- **Cannot:** pick model, pick tool, approve execution, classify risk
- **Persistence:** redacted receipt only (no raw secrets)
- **Override rule:** Secret Boundary block is FINAL — no other layer may un-block

### 2. WorkContract Routing (`kernel/work-contract/routing.ts`)

- **Owns:** task risk class, proof tier, approval policy, hard gate (allow / require_approval / blocked)
- **Can:** block execution, require approval, escalate proof tier
- **Cannot:** execute tasks, pick model/provider, lower proof tier
- **Persistence:** none (returns decision struct)
- **Override rule:** cannot override Secret Boundary block; cost cannot lower proof (`applyCostProofFloor`)

### 3. Model Routing (`kernel/model-routing/`)

- **Owns:** primitive/model/profile recommendation, cascade fallback plan
- **Can:** recommend model, suggest fallback, record sensitive surface
- **Cannot:** execute tasks, approve execution, lower proof/privacy
- **Persistence:** session memory (upgrade-only profile escalation)
- **Invariant:** `modelMayDecide = false` — always, in every projection

### 4. Control Router (`control-router/`)

- **Owns:** composed canonical route decision (capabilities + adapters + surfaces + tool routing)
- **Can:** compose all routing layers into `UnifiedRouteDecision`
- **Cannot:** execute tasks, approve execution, override hard gates
- **Persistence:** none
- **Invariant:** must pass safety flags faithfully to `planToolExecution` — never hardcode false for auth/secret/production

### 5. Skills (`kernel/skills/`)

- **Owns:** workflow hints (preferred adapter, safety class per skill)
- **Can:** match user intent to a skill, suggest adapter preference
- **Cannot:** execute tasks, approve execution, override risk/proof, create truth
- **Persistence:** none
- **Invariant:** all skills `hidden = true` — user never sees or selects skills

### 6. Tool Adapters (`kernel/tool-adapters/`)

- **Owns:** executor capability detection, adapter selection, execution mechanics
- **Can:** execute tasks (real, deterministic, scanner, fake), create proof receipts
- **Cannot:** bypass WorkContract gate, approve risky tasks, lower privacy/proof
- **Persistence:** `ToolProofReceipt` (redacted, no raw content)
- **Invariant:** argv-safe execution only (`shell: false`); forbidden tasks blocked even in fake mode

### 7. Runtime Flow (`capabilities/runtime-flow/`)

- **Owns:** lifecycle orchestration and `RuntimeSessionRecord`
- **Can:** compose all layers into a single session, persist redacted record
- **Cannot:** make independent routing decisions, override gates
- **Persistence:** `.avorelo/runtime/session.latest.json` + history (redacted)
- **Invariant:** if `gate !== "allow"`, no session/context/downstream is created

### 8. Verifier (`capabilities/runtime-flow/` — `validateRuntimeSession`)

- **Owns:** post-execution validation result
- **Can:** produce reason codes (EXECUTION_VERIFIED / REJECTED_*)
- **Cannot:** execute tasks, approve, override gates
- **Invariant:** REJECTED_* codes fail validation (fail closed); informational codes do not

### 9. Manual Gate (`kernel/tool-adapters/adapters/manual-gate.ts`)

- **Owns:** approval-required / block receipts for risky tasks
- **Can:** block execution, require human approval
- **Cannot:** claim execution happened, approve itself
- **Invariant:** never produces `status: "executed"`

### 10. Stop/Continue Gate (`kernel/stop-continue-gate/`)

- **Owns:** FINAL decision (CONTINUE / STOP_DONE / STOP_BLOCKED)
- **Can:** block based on policy, evidence, environment integrity
- **Cannot:** be overridden by model, tool, or scanner
- **Invariant:** `finalDecisionOwner = "kernel/stop-continue-gate"` in every routing output

### 11. Cost / Token Evidence (`capabilities/token-cost-evidence/`)

- **Owns:** per-run token/cost measurement with confidence labels
- **Can:** inform, record unavailable/measured/imported/estimated/inferred
- **Cannot:** lower proof tier, lower safety, claim savings without comparative evidence

## Cross-cutting Invariants

1. `modelMayDecide = false` — always, everywhere
2. `scannerMayDecide = false` — always, everywhere
3. `finalDecisionOwner = "kernel/stop-continue-gate"` — always
4. Secret Boundary block cannot be overridden by any layer
5. Cost optimization cannot lower proof tier
6. Fallback cannot lower privacy or proof
7. Normal UX never exposes routing choices (no picker)
8. No raw prompt/source/secret/model-output/terminal-output/env/git-diff persistence
9. Risky tasks (deploy/publish/billing/auth) fail closed
10. Control-router and runtime-flow must pass the same safety context to `planToolExecution`
11. Skills are workflow hints, not decision owners
12. Verifier rejection fails closed
