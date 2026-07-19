# Context Control Full Vision — Baseline Architecture Map

This document captures the architecture baseline for the Context Control full vision work.
All facts verified against commit 227377e (planning/architecture-approval-v1).

## 1. Receipt & Kernel Architecture

### Receipt Type (kernel/receipts/index.ts)

```
Receipt {
  receiptId, contractId, decision (GateDecision),
  evidenceLevels[], evidenceRefs[], safeNextActions[],
  decisionBasis { method, confidence, evidenceRefs, reasonCodes, fallbackUsed },
  redactionClasses[], receiptDigest (SHA256), sampleSize,
  writtenAt?, redaction: "applied"
}
```

- `writeReceipt(ledger, input)` — allowlist-only, no extensibility
- `persistReceipt(dir, receipt)` — writes to `.avorelo/receipts/{receiptId}.json`
- `listReceipts(dir)`, `readReceipt(dir, receiptId)` — read-only accessors
- **No capability contribution hook exists.** writeReceipt accepts only GradedEvidence from kernel evidence router.

### Evidence System (kernel/evidence/index.ts)

```
EvidenceArtifact { artifactId, kind, ref, detail? }
GradedEvidence { artifactId, level (EvidenceLevel | null), ref }
```

- Deterministic max-grade per kind (e.g., http_status_ok → NAVIGATION max)
- `isReadyEligible(graded)` — requires OUTCOME + POST_ACTION (ADR-3)

### Stop/Continue Gate (kernel/stop-continue-gate/index.ts)

- Policy block is supreme (ADR-4): block → STOP_BLOCKED
- READY = OUTCOME + POST_ACTION + plausible + no NO_GO + clean environment
- Confidence: sampleSize 1→LOW, 2-4→MED, ≥5→HIGH

### Run Pipeline (kernel/run.ts)

```
runSlice1(input: RunInput) → { gate, receipt, ledger }

RunInput {
  contract: WorkContract, artifacts: EvidenceArtifact[],
  content?, touchedPaths?, reviewerVerdicts?, stopConditionMet?,
  sampleSize?, ledger?, receiptId?
}
```

Pipeline: evaluatePolicy → gradeAll → decide → writeReceipt

### Registry (kernel/registry/index.ts)

THE ONE RULE: each concern has exactly one owner.
Concerns: policy, evidence, receipts, approval, stop-continue-gate, state-ledger, redaction, routing, runtime-boundary, sync-boundary.

## 2. Session Lifecycle (capabilities/session)

### SessionState (session-store.ts)

```
SessionState {
  sessionId, contractId, objective, status,
  adapterIds[], controlTier, controlTierLabel,
  allowedPaths[], toolCallCount,
  evidenceAccumulated: EvidenceArtifact[],  // ← capabilities contribute here
  driftSignals[], interventionLog[], filesChanged[],
  commandsRun[], failedCommands[], sensitiveFilesTouched[],
  routing, correctionsApplied[], startedAt, updatedAt, closedAt?, closeReason?
}
```

### How Capabilities Contribute to Receipts

1. Capabilities submit EvidenceArtifact objects to `SessionState.evidenceAccumulated` during hook events
2. On SessionEnd, session feeds all accumulated artifacts to `runSlice1()`
3. Kernel receipt is built from deterministically-graded evidence
4. **This is the only sanctioned path for capabilities to influence receipts**

## 3. Runtime Flow (capabilities/runtime-flow)

8-layer ordered composition (all local-first, deterministic):

1. L1+L2: Safety + Routing (secret-boundary + work-contract/routing)
2. Session (lifecycle owner)
3. L3 Context Compiler (compileContext)
4. L3 Continuity (carry-forward prior intent)
5. L4 Token & Cost Evidence (UNAVAILABLE at prep time)
6. L4 Proof Report
7. L4 Value Ledger
8. L4 Efficiency Sync (dry-run only)

**Context Check is NOT called in runtime flow.** It is standalone diagnostic only.

### RuntimeSessionRecord

```
contract: "avorelo.runtimeSession.v1"
Contains: runtimeSessionId, status, gate, routing metadata,
per-layer reference projections (counts/ids/codes only)
Written to: .avorelo/runtime/session.latest.json + session.history.jsonl
```

## 4. Work Contract Model

### Base WorkContract (shared/schemas)

```
WorkContract {
  contractId, objective, allowedPaths[], requestedOutputs[],
  successCriteria[], stopConditions[], evidenceRefs[],
  reviewReasons[], planTier
}
```

**No excludedPaths field.**

### EnrichedWorkContract (routing layer adds)

```
EnrichedWorkContract = WorkContract & {
  nonGoals[], disallowedPaths[] (derived by routing),
  riskClass, route, proofTier, approvalPolicy,
  safetyBoundary, costPolicy
}
```

- `disallowedPaths` is derived deterministically (security defaults: .env, .ssh, .pem, id_rsa)
- Never part of base WorkContract

### WorkContractRef (context-check projection)

```
WorkContractRef {
  objective?, nonGoals?, allowedPaths?,
  riskFlags?, validationPlan?, definitionOfDone?
}
```

- Loose, optional-field projection for CLI loading
- Adds riskFlags/validationPlan/definitionOfDone (context-check-specific)
- Missing: contractId, requestedOutputs, successCriteria, etc.

### Gap: WorkContractRef ≠ WorkContract

WorkContractRef is a context-check-specific subset. The kernel WorkContract has no excludedPaths. EnrichedWorkContract adds disallowedPaths (security-derived, not context exclusions).

## 5. Control Center (capabilities/control-center)

- Read-only projection of all local artifacts
- Calls loaders from: runtime-flow, token-cost, proof-report, value-ledger, continuity, local-dashboard, billing
- **No context-check integration**
- Outputs: ControlCenterModel → renderText / renderHtml
- Written to: `.avorelo/control-center/index.html`

## 6. Doctor (CLI surface)

Displays health checks for:
1. Adapters (tier classification, detection signals)
2. Hooks (installation status, latency)
3. Session (status, tier, drift, corrections)
4. Watcher (Tier B file observation)
5. Monorepo (strategy, workspace count)
6. **Context Check** (inline diagnostic via runContextCheck)
7. Feedback (config)
8. Notices (update state)

**Context Check IS called in doctor** — the only runtime surface that uses it.

## 7. Local Storage Conventions (.avorelo/)

| Directory | Writer | Contents |
|-----------|--------|----------|
| runtime/ | runtime-flow | session.latest.json, session.history.jsonl |
| context/ | context-compiler | latest.json, context.history.jsonl |
| continuity/ | continuity | latest.json |
| evidence/ | token-cost-evidence | token-cost.jsonl |
| proof/ | proof-report | proof-report.json |
| value-ledger/ | value-ledger | value-ledger.jsonl |
| efficiency-sync/ | efficiency-sync | queue.jsonl |
| receipts/ | kernel/session | *.json, *.md (rendered) |
| dashboard/ | local-dashboard | index.html |
| control-center/ | control-center | index.html |
| secret-boundary/ | PostToolUse hook | receipts.jsonl |
| activation/ | activation | activation-state.json |

**No .avorelo/context-check/ directory exists.**

## 8. Context Check V1 (capabilities/context-check)

- Read-only analysis: scanSources → classify → render
- 8 finding types, 3 renderers (human, json, receipt)
- CLI: `avorelo context check [--target] [--json] [--strict] [--work-contract]`
- Doctor: inline lightweight diagnostic
- **Not in runtime flow, not in session, not in receipts pipeline**
- Receipt renderer produces lines but they aren't consumed by anything

### V1 Limitations (proven architectural)

1. **No receipt contribution hook** — kernel receipts are allowlist-only, no plugin model
2. **No excludedPaths source** — no agent format exposes deterministic exclusion metadata
3. **No local persistence** — results are stdout-only, no .avorelo/context-check/ storage

## 9. Extension Points for Full Vision

### A. Receipt Integration Path

The sanctioned path: capabilities contribute EvidenceArtifact objects to SessionState.evidenceAccumulated during hook events. On SessionEnd, these feed runSlice1 → writeReceipt.

**Option 1 (within existing architecture):** Context Check produces EvidenceArtifact objects (kind: "source_of_truth_readback" for clean scan, "fixture" for issues found) and contributes them to session evidence during a hook event.

**Option 2 (capability-level receipt):** Like secret-boundary, Context Check builds its own receipt schema (avorelo.contextCheck.v1) and persists it independently of kernel receipts. Both receipts exist in parallel.

### B. ExcludedPaths Source

EnrichedWorkContract adds disallowedPaths (security defaults). Context-check needs a different concept: paths excluded from agent context that overlap with work scope. Sources:

1. Add excludedPaths to WorkContractRef (user-specified via --work-contract JSON)
2. Derive from EnrichedWorkContract.disallowedPaths (different semantics but related)
3. Add Avorelo context policy file (.avorelo/context-policy.json)

### C. Runtime Integration

Context Check could become a runtime-flow layer (L3, after context compiler). The RuntimeSessionRecord already has a `context?` field. Adding context-check findings as a sub-projection is architecturally clean.

## 10. Roadmap

V2 and V3 candidates derived from these extension points are tracked in the project's internal Agent Context Control Roadmap.

## 11. Baseline Validation Results

- Tests: 26/26 pass (context-check.test.ts)
- Dogfood: 21/21 gates pass (context-check.ts)
- Package check: clean
- Naming check: clean
- Working tree: clean on feature/context-control-full-vision
- Base commit: 227377e (planning/architecture-approval-v1)
