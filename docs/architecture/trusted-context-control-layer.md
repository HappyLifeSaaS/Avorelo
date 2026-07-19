# Trusted Context Control Layer — Architecture

## Purpose

The Trusted Context Control Layer transforms raw project memory (CLAUDE.md, AGENTS.md, receipts, git state, policies, handoffs) into trusted, task-specific working truth for AI coding agents.

Memory is not truth. Evidence-backed, policy-governed memory can become working truth.

## System overview

```
Context Sources         Normalization       Trust/Freshness      Promotion
┌──────────────┐       ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ CLAUDE.md    │       │              │    │              │    │              │
│ AGENTS.md    │──────▶│ Typed items  │───▶│ Trust scores │───▶│ Promote/     │
│ receipts     │       │ safety check │    │ Freshness    │    │ Reject/Mark  │
│ git state    │       │ redaction    │    │ scores       │    │ Supersede    │
│ policies     │       └──────────────┘    └──────────────┘    └──────────────┘
│ activation   │              │                   │                   │
│ package.json │              ▼                   ▼                   ▼
│ docs         │       ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
└──────────────┘       │ Conflict     │    │ Mode         │    │ Budget       │
                       │ Detection    │    │ Detection    │    │ Manager      │
                       └──────────────┘    └──────────────┘    └──────────────┘
                              │                   │                   │
                              └───────────────────┼───────────────────┘
                                                  ▼
                                        ┌──────────────────┐
                                        │  Brief Compiler   │
                                        │                  │
                                        │ Trusted Work Brief│
                                        └────────┬─────────┘
                                                 │
                              ┌──────────────────┬┴──────────────────┐
                              ▼                  ▼                   ▼
                       ┌──────────┐       ┌──────────┐       ┌──────────┐
                       │ Receipts │       │ Storage  │       │ Agent    │
                       │          │       │          │       │ Guard    │
                       └──────────┘       └──────────┘       └──────────┘
```

## Module boundaries

All modules live under `src/avorelo/kernel/context-control/`.

| Module | Responsibility |
|---|---|
| `types.ts` | All type definitions and interfaces |
| `discovery.ts` | Find and catalog context sources in repo |
| `normalization.ts` | Convert sources into typed ContextMemoryItem |
| `redaction.ts` | Secret detection, content redaction |
| `trust.ts` | Trust and freshness scoring |
| `promotion.ts` | Decide whether items become active memory |
| `conflicts.ts` | Detect and resolve context conflicts |
| `mode-detection.ts` | Infer work mode from signals |
| `budget.ts` | Allocate token budget across items |
| `brief-compiler.ts` | Generate Trusted Work Brief |
| `receipts.ts` | Create context-related receipts |
| `storage.ts` | Local-first persistence |
| `agent-guard.ts` | Block/allow/downgrade agent actions |
| `index.ts` | Public API and orchestration |

## Data flow

1. **Discovery** scans repo for instruction files, receipts, policies, activation state, docs, package metadata
2. **Normalization** creates typed `ContextMemoryItem` for each source section, with safety/trust/freshness metadata
3. **Trust scoring** evaluates each item: receipt-backed = verified, git = verified, external = unverified, secret = unsafe
4. **Freshness scoring** evaluates recency: current (<1 day), recent (<1 week), stale (<1 month), expired (>1 month)
5. **Promotion** decides per item: promote, reject, mark_unsafe, mark_unverified, supersede
6. **Conflict detection** finds contradictions: production claims vs deploy evidence, test pass vs dirty worktree, stale handoffs
7. **Mode detection** infers work mode from branch, files, task text, commands, receipts
8. **Budget allocation** prioritizes safety > verified facts > blockers > proof > state > decisions
9. **Brief compilation** assembles concise Trusted Work Brief markdown
10. **Receipts** record every decision for traceability

## Storage model

All state is local-first under `.avorelo/`:

```
.avorelo/
├── context/
│   ├── discovery.json     # Last discovery result
│   ├── items.jsonl        # Normalized context items (one JSON per line)
│   ├── conflicts.json     # Detected conflicts
│   ├── mode.json          # Current mode detection
│   └── state.json         # Dashboard state contract
├── work-briefs/
│   ├── latest.md          # Current brief
│   └── <timestamp>.md     # Historical briefs
└── receipts/
    └── context/           # Context decision receipts
```

## Receipt model

Every context decision generates a receipt:
- `work_brief_receipt` — documents brief generation
- `context_exclusion_receipt` — documents excluded items and reasons
- `memory_promotion_receipt` — documents promotion decisions
- `context_conflict_receipt` — documents detected conflicts
- `agent_context_decision_receipt` — documents blocked/allowed/downgraded actions

All receipts guarantee: `containsRawPrompt: false`, `containsRawSource: false`, `containsRawSecret: false`.

## Trust hierarchy

1. Receipt-backed evidence (verified, 0.95)
2. Git state (verified, 0.9)
3. Explicit policy files (confirmed, 0.9)
4. Dashboard/activation state (confirmed, 0.8)
5. Project instruction files (confirmed, 0.8)
6. Inferred from local files (inferred, 0.7)
7. External sources (unverified, 0.3)
8. Secret content (unsafe, excluded)

## Agent Guard integration

The guard evaluates actions against current working truth:
- npm publish → always blocked (owner-side only)
- production deploy → blocked unless production_release mode with owner approval
- force push → blocked (destructive)
- completion claims without receipt → downgraded to "pending verification"

## Future backend interfaces

The storage layer is designed for future extension:
- `LocalMemoryBackend` — current implementation
- `ExternalMemoryBackend` — future external storage
- `MCPMemorySource` — future MCP server integration
- `CloudSyncMemoryBackend` — future cloud sync

External sources would enter as `unverified` and require local validation before promotion.
