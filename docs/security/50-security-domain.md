# 50 — Security Domain (Phase 9)

**Status:** COMPLETE (lead-authored on VERIFIED research)
**Decision:** `SECURITY_DOMAIN_GO`
**Date:** 2026-06-08
**Authority:** VERIFIED primary sources — OWASP Agentic Skills Top 10 (CC-BY-SA-4.0, incubator v1.0,
AST01–AST10); Snyk "ToxicSkills" (2026-02-05); agentskills.io spec; ClawHub (MIT, non-Anthropic);
Claude Code security docs; OpenHands SDK (MIT). Carries spine changes **S1–S5** from `08-...md`.

> Security is **one full Kernel-cross-cutting domain**, not the whole product and not a footnote. It
> enforces invariants that no capability, skill, surface, or model output may weaken.

---

## 1. Security control plane (where it lives)
Owned by the Kernel + the `security-control-plane` / `runtime-boundary` / `skill-mcp-tool-governance`
capabilities. Surfaces and skills **consume** verdicts; they never define them (THE ONE RULE).

| Control | Owner | Enforced at |
|---|---|---|
| Secret Exposure Guard | `kernel/runtime-boundary` + secret-protection | pre-context, PreToolUse, receipt write, sync |
| Runtime Boundary | `kernel/runtime-boundary` | every fs/net/secret access |
| MCP / tool governance | tool-router + `skill-mcp-tool-governance` | connector/tool enable + each call |
| Skill supply-chain governance | `skill-mcp-tool-governance` (intake) | before any skill loads |
| Dependency / package integrity | `supply-chain-dependency-integrity` | install / lockfile / CI |
| Unicode / homoglyph guard | secret-protection + skill intake | SKILL.md / fetched-content scan |
| Prompt-injection guard | `prompt-injection-guard` | UserPromptSubmit, web-fetch, tool output |
| Connector safety | connector-safety (cso) | connector add / call |
| CI/CD secret safety | deployment-readiness | pre-commit, pre-deploy |
| Deployment security | deployment-readiness + approval | deploy actions |
| Audit / proof sanitization | `kernel/receipts` + `shared/redaction` | every durable write |

## 2. Security invariants (hard; no tier/skill/model may weaken — S1/S2)
No raw secret to: **LLM · cloud · receipts · audit/events · dashboard · logs/errors · issue/PR text ·
telemetry · screenshots/proof · tests/golden outputs.** Plus: **no model/skill output overrides
deterministic policy**; **no external/destructive/security-sensitive action without compact approval**;
**bundled skill `scripts/` never auto-execute** (sandbox + approval only); **`allowed-tools` is a ceiling
enforced by the Tool Router, never self-granted**; **Accept-Edits `rm` auto-approve is overridden**;
verification works **offline** (no registry dependency for safety).

## 3. OWASP AST01–AST10 → Avorelo invariant mapping (VERIFIED)
| AST | Risk | Avorelo prevention | Kernel invariant |
|---|---|---|---|
| AST01 | Malicious skills ("3 lines of SKILL.md can read+exfil SSH keys") | scan-before-load; signing; no script auto-exec | S3 |
| AST02 | Supply-chain ("configs silently exec shell before trust dialog") | ed25519 sig + sha256 hash; sandbox scripts; approval | S1/S3 |
| AST03 | Over-privileged skills | `allowed-tools` ceiling via Tool Router | S1 |
| AST04 | Insecure metadata (fake-"Google" impersonation) | provenance + signature; trust tiers | S3 |
| AST05 | Unsafe deserialization | no eval of skill-supplied data; schema-validated inputs | S1 |
| AST06 | Weak isolation | container/sandbox default; host-mode opt-in+approval | S4 |
| AST07 | Update drift | content-hash pinning + modification alerts | S3 |
| AST08 | Poor scanning | mandatory pre-load scan (injection/Unicode/secret) | S3 |
| AST09 | No governance | skill-governance intake pipeline + registry | S3/S5 |
| AST10 | Cross-platform reuse | per-environment trust re-evaluation | S3 |

## 4. Verified threat scale (why this is first-class)
Snyk 2026-02-05: 3,984 skills → **13.4% critical, 36.82% ≥1 flaw, 76 confirmed malicious payloads,
prompt injection in 91% of malicious, 100% malicious-code patterns, 10.9% hardcoded secrets, 17.7%
third-party content (indirect injection), 2.9% dynamic remote exec.** OWASP ClawHavoc: **1,184 malicious
skills**, 341 in a 3-day window. → **external skills are untrusted by default (T3).**

## 5. Secret Exposure Guard (S2 detail)
- **Patterns:** AWS `AKIA…`, GitHub `ghp_…`, OpenAI `sk-…`, Slack `xoxb-…`, generic high-entropy,
  `.env`/`~/.aws/credentials`/`~/.ssh` read attempts (Snyk exfil technique #2: base64/Unicode-obfuscated).
- **Where:** pre-context (block before reaching LLM), PreToolUse (block exfil commands), receipt/sync
  (redact), dashboard (redact). **Fast path** = static scan; **slow path** = deep entropy/history sweep.
- **On hit:** block + compact "secret detected" receipt (redacted) + safe next action (rotate/remove).

## 6. Runtime Boundary
Mediates all fs/net/secret. **The platform sandbox is NOT relied upon** (VERIFIED: Claude Code sandbox
"reduces risk but is not a complete isolation boundary"; default reads still expose `~/.aws`,`~/.ssh`;
Bash runs with user perms). Avorelo adds: deny-list secret reads to model context; network egress to
unknown hosts requires approval; web-fetch in isolated context (VERIFIED Claude Code pattern).

## 7. Skill / MCP / connector supply-chain governance (S3)
Intake pipeline (offline-capable): **provenance (author/repo/commit) → ed25519 signature verify →
sha256 content-hash pin → license check → static scan (injection / hidden-Unicode / secret / bundled-
script) → marginal-utility eval → trust tier T0–T3 → register.** Any failure → **T3 quarantine, cannot
load.** `scripts/` exec = sandbox (container default) + compact approval. MCP: trust-before-connect +
explicit approval (VERIFIED Claude Code `.mcp.json` model).

## 8. Dependency / supply-chain integrity
Lockfile integrity, install-script risk flagging, typosquat detection, and (where available)
**SLSA/Sigstore-style provenance** — marked **UNVERIFIED for exact applicability** pending a focused
pass; treated as design intent, not cited fact.

## 9. Audit / proof sanitization
Every durable write (receipt, event, dashboard payload, sync metadata) passes `shared/redaction`.
Golden/test outputs are scrubbed. No raw prompts/transcripts/source by default (ADR-5).

## 10. Performance posture (S4)
Fast path: static secret + metadata scans at PreToolUse (budget in Phase 12, target sub-second).
Slow path: deep behavioral skill scan, full secret history sweep, browser proof — async/post-session.

## 11. Free / Pro / Teams
Secret block, prompt-injection guard, runtime boundary, skill-signing = **Free (never paywalled —
basic safety)**. Deep supply-chain scans, connector governance dashboards = Pro. Org policy / SSO /
teams audit = Teams.

## 12. Skill Review (this phase)
| Reviewer | Category | Verdict | Basis |
|---|---|---|---|
| security-review | existing `cso` + `deep-research` (research **ran**, cited) | GO | AST01–10 mapped; invariants set |
| secret-safety | existing `cso` (lead-applied) | GO via S2 | secret patterns + Accept-Edits `rm` override |
| skill-governance-review | NEEDS_AVORELO_NATIVE_SKILL | GO (design) via S3 | intake pipeline defined |
| external-reference-review | `deep-research` + targeted WebFetch (**ran**) | GO | OWASP/Snyk/ClawHub/agentskills.io cited |
| connector-safety-review | existing `cso` (lead-applied) | GO via S1/S3 | MCP trust + signing |

## 13. Risks / open questions
- SLSA/Sigstore applicability UNVERIFIED → focused pass before building supply-chain capability.
- Signing UX must not block local-first first-value (own/T0 skills are pre-trusted).
- Hidden-Unicode detection completeness is hard → defense-in-depth + approval, not a single check.

---

### Decision: `SECURITY_DOMAIN_GO`
Security is a first-class Kernel-cross-cutting domain with VERIFIED-backed invariants (AST01–AST10,
Snyk scale), secret guards (S2), signed/scanned skill intake (S3), runtime boundary independent of the
platform sandbox, and a fast/slow performance posture (S4). No raw secret crosses any boundary; no
model output overrides policy.
