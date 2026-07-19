# Skill / Repo Adoption Process

**Status:** ACTIVE | **Date:** 2026-06-09

---

## Purpose
Governed process for adopting any external repo, skill, reference, framework, benchmark, or tool into Avorelo. Every candidate follows a deterministic lifecycle. No candidate remains UNKNOWN.

## Lifecycle
1. **Intake** — normalize candidate to schema
2. **Quarantine** — no install, no execute, metadata only
3. **Need fit** — does Avorelo need this?
4. **Architecture fit** — which layer? conflicts?
5. **Security review** — license, provenance, side effects, risk
6. **Conflict review** — overlaps, duplicates, authority conflicts
7. **Cost review** — context/token/latency overhead
8. **Routing** — when to activate, when to skip
9. **Decision** — ADOPT/DEFER/REJECT with rationale
10. **Adaptation** — reference, checklist, executable, or native rewrite
11. **Tests + dogfood** — evidence of correct adoption
12. **Receipt** — proof of adoption decision
13. **Learning** — measure whether adoption was worth it

## Decision Types
| Decision | Meaning |
|---|---|
| ADOPT_EXECUTABLE_NOW | Safe to run as code |
| ADOPT_CHECKLIST_NOW | Use as review checklist |
| ADOPT_AS_REFERENCE | Reference/documentation only |
| ADOPT_AS_AVORELO_NATIVE_REWRITE | Concept adopted, code rewritten |
| MERGE_INTO_EXISTING_SKILL | Overlaps with existing — merge |
| DEFER_BACKLOG | Valuable but not now |
| REJECT_UNSAFE | Security/architecture risk |
| REJECT_DUPLICATE | Fully covered by existing |
| REJECT_LICENSE_UNKNOWN | Cannot use without license clarity |
| REJECT_NOT_RELEVANT | Does not serve AI Work Control |
| NEEDS_BENJAMIN_APPROVAL | Requires human decision |
| NEEDS_MORE_EVIDENCE | Insufficient info to decide |

## Quarantine Rules
- Unknown license blocks executable adoption
- Unknown provenance blocks executable adoption
- External write side-effects blocked by default
- No copied code without security review
- No untrusted scripts executed

## Token/Cost Policy
- Token/cost optimization tools are valued but not the product category
- They enter as context_budget_extension, tool_exposure_extension, or reference
- Exact token savings claims require measured data
- No unsupported ROI or percentage claims

## Commands
- `npm run adopt:skill-batch` — process all baseline candidates
- `npm run dogfood:skill-adoption` — 10-scenario proof of process
- `npm run dogfood:skill-adoption` — skill adoption dogfood