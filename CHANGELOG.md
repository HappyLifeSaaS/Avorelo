# Changelog

All notable changes to Avorelo are documented in this file.

## [0.0.1-alpha.1] — 2026-06-13

### Added
- Core product flow: init, status, run, control-center, open, readiness
- Secret boundary: detect before context, redact before model, block before action
- Confidence-labelled evidence: savings refused without comparative proof
- Local-first operation: no signup, no network, no credentials required
- Dogfood learning: opt-in, sanitized, preview before send, purge, disable
- Managed updates: opt-out, source checkouts never silently mutated
- Distributed rate limiter with atomic upsert and SHA-256 hashed bucket keys
- Billing entitlement resolver (test mode, fail-closed)
- Dashboard gate model: Free/Pro/Teams tiers
- Loop control: path-scoped loops, user-defined checks, test runner auto-detection
- Loop continuity: loop latest, loop resume (display-only), loop doctor
- Clean uninstall: removes `.avorelo/`, adapter hooks, restores settings
- Customer-facing docs: getting-started, install, uninstall, privacy, troubleshooting, update
- Support docs: bug report template, triage playbook, support handbook
- Ops docs: runbook, rollback runbook
- Market-ready audit and release documentation

### Security
- Fail-closed payload validator with strict allowlist
- No source code, secrets, logs, env, diffs, or prompts ever sent
- Secret pattern detection: AWS keys, GitHub tokens, JWTs, private keys, Slack tokens, OpenAI keys
- Path and filename detection in payloads
- Double validation: client + server

### Process
- SaaS Legal Writing Skill System v2.0 (13 skills)
- Document review matrix, templates, source-backed writing rules
- Marketing positioning, claims register, copy guides
- Legal source map, review reports, DPA/subprocessors drafts
- Billing readiness report, refund/cancellation review
- Support playbook, incident escalation, issue register
- Human decision register, go/no-go decision

### Status
- `SAAS_SKILLS_LEGAL_BILLING_MARKETING_PROCESS_ADOPTED_PENDING_FINAL_APPROVALS`
- Not published to npm
- Billing not activated (test mode only)
- Pricing not final
- Public launch not approved
- Legal review required
