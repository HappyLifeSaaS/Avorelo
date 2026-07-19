# Architecture Ownership Map

**Status:** ACTIVE | **Slice:** 4.5
**Spine:** `docs/architecture/20-canonical-architecture.md`

---

## THE ONE RULE
Each concern has exactly one owner. No capability, skill, router, adapter, or surface may create its own policy engine, evidence model, receipt writer, approval logic, dashboard schema, readiness gate, or state store.

## Layer Map

### Kernel (owns truth)
| Module | Owner | Status |
|---|---|---|
| work-contract | kernel/work-contract | Slice 1 ✓ |
| policy | kernel/policy | Slice 1 ✓ |
| evidence | kernel/evidence | Slice 1+4 ✓ |
| state-ledger | kernel/state-ledger | Slice 1 ✓ |
| stop-continue-gate | kernel/stop-continue-gate | Slice 1+4 ✓ |
| receipts | kernel/receipts | Slice 1+3 ✓ |
| runtime-boundary | kernel/runtime-boundary | Slice 2 ✓ |
| pretooluse-gate | kernel/pretooluse-gate | Slice 2 ✓ |
| registry | kernel/registry | Slice 1 ✓ |
| run (orchestrator) | kernel/run | Slice 1 ✓ |

### Capabilities (compose kernel contracts)
| Capability | Owner | Status |
|---|---|---|
| activation | capabilities/activation | Slice 2 ✓ |
| secret-protection | capabilities/secret-protection | Slice 1 ✓ |
| local-dashboard | capabilities/local-dashboard | Slice 3 ✓ |
| production-confidence | capabilities/production-confidence | Slice 4 ✓ |
| context-budget | capabilities/context-budget | Slice 4.5 ✓ |
| tool-governance | capabilities/tool-governance | Slice 4.5 ✓ |
| migration-scorecard | capabilities/migration-scorecard | Slice 4.5 ✓ |
| payment-readiness | capabilities/payment-readiness | Slice 5 (planned) |
| session-collision | capabilities/session-collision | Slice 4.5 (planned) |
| scope-repair | capabilities/scope-repair | Future |
| context-hygiene | capabilities/context-hygiene | Future |
| autonomous-iteration | capabilities/autonomous-iteration | Future |
| browser-visual-qa | capabilities/browser-visual-qa | Future |
| governed-exposure | capabilities/governed-exposure | Slice 6 (planned) |
| teams-governance | capabilities/teams-governance | Slice 6 (planned) |
| dogfooding-system | capabilities/dogfooding-system | Slice 4.5+ |
| cloud-claim-sync | capabilities/cloud-claim | Slice 6 (planned) |

### Adapters (translate to/from outside world)
| Adapter | Owner | Status |
|---|---|---|
| claude-code | adapters/claude-code | Slice 2 ✓ |
| lemon-squeezy | adapters/lemon-squeezy | Slice 5 (planned) |
| codex | adapters/codex | Future |
| cursor | adapters/cursor | Future |
| windsurf | adapters/windsurf | Future |
| github | adapters/github | Future |

### Surfaces (render only, own nothing)
| Surface | Owner | Status |
|---|---|---|
| CLI | surfaces/cli | Slice 1-4 ✓ |
| local-dashboard (HTML) | surfaces/cli + capabilities/local-dashboard | Slice 3 ✓ |
| public-web | surfaces/public-web | Slice 5 (planned) |
| cloud-dashboard | surfaces/cloud-dashboard | Slice 6 (planned) |

## Collision Prevention
- `kernel/registry` enforces single ownership at startup/CI
- `tools/naming-check.ts` enforces avorelo-only naming
- Tests in slice1.test.ts verify collision detection
- Migration scorecard flags duplication risk per candidate
