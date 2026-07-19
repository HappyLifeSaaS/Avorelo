# 70 — Local-first / Cloud / Activation Model (Phase 11)

**Status:** DESIGN / PLANNING ONLY (no `src/avorelo/**` code; nothing migrated/copied)
**Decision:** `LOCAL_CLOUD_ACTIVATION_GO` (see end)
**Date:** 2026-06-08
**Authority basis:** `docs/architecture/20-canonical-architecture.md` (canonical spine, `CANONICAL_ARCHITECTURE_GO`)
+ Kernel singletons (Sync Boundary, Receipt Writer, Runtime Boundary) defined there. This doc expands the
spine; it may not contradict it. Any gap is recorded under **Risks / open questions**, not resolved by
inventing architecture.

---

## Purpose

Specify how Avorelo delivers value **locally first**, how (and only how) data may cross to an optional
cloud, and the **activation path** a user walks from `npx` to first receipt to optional account claim.

Avorelo is a **local-first AI Work Control Kernel**. The local runtime *is* the product center. The cloud
is an optional, sanitized projection — never the source of truth and never required to get value. This
doc binds three concerns to Kernel singletons:

1. **Local-first rules** — what works with zero account, what stays on-device by default.
2. **Activation path** — the deterministic sequence from install to first proof, validated by `doctor`.
3. **Claim / Sync Boundary** — exactly what may cross to cloud and what may never cross, owned solely by
   the Kernel **Sync Boundary** singleton (`kernel/sync-boundary`).

**Binding constraint (THE ONE RULE):** no surface, adapter, or capability owns its own sync policy,
redaction, receipt, approval, or readiness gate. The cloud Surface and the activation flow **call**
Kernel singletons — `kernel/sync-boundary`, `kernel/receipts`, `kernel/runtime-boundary`,
`kernel/policy`, `kernel/stop-continue-gate`. There is exactly one durable writer (Receipt Writer) and
exactly one egress chokepoint (Sync Boundary).

---

## Local-first rules

Mapped to spine surfaces/boundaries. These are invariants, not preferences.

1. **Local value first.** The Free tier delivers the full safety/truth core entirely on-device: Work
   Contract, Evidence Router gates, Policy Matrix, Stop/Continue Gate, secret-block (S2), fake-READY-block
   (Evidence Router kills no-404=proof and redirect=payment), and local receipts. Basic safety, truth, and
   recovery are **never paywalled** (per PLAN TIERS).
2. **No signup for first value.** Activation produces a usable kernel and a first receipt with **no account
   and no network**. A user who never connects gets the complete local product.
3. **Optional claim later.** `avorelo claim` is opt-in and reversible in intent; it associates an existing
   local install with an account. It is never a precondition for local execution.
4. **Cloud sync = sanitized metadata only.** Only Sync-Boundary-sanitized receipt *metadata* and rollups
   may cross. The Sync Boundary is the single egress chokepoint (Runtime Boundary governs ingress of
   secrets; Sync Boundary governs egress to cloud).
5. **Never crosses:** raw secrets, raw prompts, model transcripts, execution logs, source code,
   file contents, raw evidence payloads. (S2 secret invariants apply unconditionally regardless of tier
   or platform sandbox.)
6. **User/team policy controls sync.** Whether *any* metadata leaves the device is a Policy Matrix decision
   (`{allow|block|needs_approval}`); the model cannot override it (S2 / Policy invariant). Default for a
   fresh install is **no egress** until claim + explicit policy allow.
7. **Cloud dashboard is NOT the product center.** It is a sanitized projection for visibility/governance
   (Teams rollups, role/approval). It cannot drive execution, cannot author receipts, and cannot relax a
   gate. **Local runtime IS the center**: the State/Event Ledger and Receipt Writer on-device are
   authoritative; cloud is downstream and disposable.

---

## Activation path

Deterministic sequence. Each step is observable and gated; nothing claims "ready" without evidence.

```
npx avorelo@latest activate
   ↓  (no account, no network required)
local value           — kernel installs; Free core live on-device
   ↓
Work Contract         — first intent captured as a Work Contract (Kernel)
   ↓
hooks configured      — Claude Code hooks wired as ENFORCEMENT (VERIFIED: hooks=enforcement,
   ↓                     memory=context-not-enforcement) [REFERENCE_ONLY anchor]
hooks VALIDATED       — `avorelo doctor` proves hooks are actually installed + firing
   ↓                     (deterministic check; see Old-repo lessons)
first receipt         — Receipt Writer emits the first durable, redacted receipt (local)
   ↓
avorelo open          — local dashboard opens against the on-device State/Event Ledger
   ↓
avorelo claim         — OPTIONAL: associate install with account; enables sanitized sync
```

Properties:

- **`activate` is offline-capable.** Steps through `first receipt` require no network. (`npx` itself
  fetches the package; once installed, activation completes offline.) **UNVERIFIED:** exact npm cache /
  air-gap install behavior — see Risks.
- **`doctor` is the readiness oracle for hooks.** "Hooks configured" and "hooks validated" are distinct.
  Configuration (a file exists) is not enforcement; `doctor` runs a deterministic probe and only reports
  hooks as enforcing when they actually fire. This is the direct fix for the old-repo failure below.
- **First receipt before claim.** The user sees durable proof of value *before* any account or cloud step.
- **`open` reads local truth.** The local dashboard Surface renders from the on-device ledger; it is
  fully functional with no cloud connection.

---

## Claim / Sync Boundary

Single chokepoint: `kernel/sync-boundary`. The cloud Surface and `avorelo claim` **call** it; they never
serialize-and-send on their own. Egress is allowed only when (a) install is claimed AND (b) Policy Matrix
returns `allow` for sync.

| Direction | Crosses to cloud | Owner / gate |
|---|---|---|
| Receipt **metadata** (id, verdict, gate level reached, timestamps, capability name) | YES — sanitized | Sync Boundary + Receipt Writer redaction |
| Rollups / aggregate counts (Teams governance) | YES — sanitized | Sync Boundary (Teams tier) |
| Approval *records* (who approved what, decision) | YES — sanitized metadata only | Sync Boundary + Approval |
| Raw secrets / credentials | **NEVER** | S2 invariant (unconditional) |
| Raw prompts / model transcripts | **NEVER** | S2 / Sync Boundary |
| Execution logs | **NEVER** | Sync Boundary |
| Source code / file contents | **NEVER** | Sync Boundary |
| Raw evidence payloads (page DOM, screenshots, network bodies) | **NEVER** (only derived verdict crosses) | Evidence Router + Sync Boundary |

Rules:

- **Redaction happens at the writer, egress is filtered at the boundary** — defense in depth. A receipt is
  already redacted when authored (Receipt Writer via `shared/redaction`); the Sync Boundary applies a
  second sanitize + allowlist before any byte leaves the device. Anything not on the allowlist does not
  cross.
- **Claim is account-association, not data unlock.** Claiming does not retroactively export local history;
  only post-policy-allow metadata flows, and only forward.
- **Cloud cannot write back authoritative state.** Sync is a one-way sanitized projection for visibility;
  the cloud Surface cannot mutate the local ledger, author receipts, or alter gates (THE ONE RULE).

---

## Offline safety

Provenance and signing verification (S3) are **local, offline operations** — they must not depend on the
network or the cloud.

- **Skill intake verifies offline.** ed25519 signature check + sha256 hash check + scan-before-load run
  entirely on-device against locally held public keys / pinned hashes. A disconnected machine can still
  reject a tampered or unsigned skill. External skills default to **T3** and never auto-exec scripts (S3).
- **Secret-block works offline.** S2 invariants (no raw secret to LLM/cloud/logs/receipts/dashboard;
  pre-context secret scan) are enforced locally by the Runtime Boundary; they do not weaken when the cloud
  is unreachable.
- **Gates work offline.** Evidence Router, Policy Matrix, and Stop/Continue Gate are deterministic local
  functions. READY (needs OUTCOME + POST_ACTION) is decided on-device.
- **Failure mode is closed.** If verification material (keys/hashes) is missing, intake **blocks**; it does
  not fall back to network trust. **UNVERIFIED:** key-distribution / rotation mechanism for offline pins —
  see Risks.

---

## Old-repo lessons

**Source material only — no code copied.** The dominant prior failure:

- **Hooks existed but were not installed.** The old repo *shipped* hook definitions, but they were not
  actually wired into the runtime, so enforcement silently did nothing — the system *looked* governed but
  ran ungoverned. This is precisely the "never present something as ready if it is not ready" violation.

Design responses (already encoded above):

1. **Configured ≠ validated.** The activation path makes these two distinct steps; "hooks configured"
   alone never advances readiness.
2. **`doctor` is a hard gate.** A deterministic probe must observe hooks *firing* before the install is
   reported healthy. Memory is context, not enforcement (VERIFIED Claude Code distinction); only hooks
   enforce, and only `doctor`-validated hooks count.
3. **First receipt proves the loop end-to-end.** The activation sequence cannot complete without the
   Receipt Writer emitting a real, durable receipt — evidence the control loop actually executed.

---

## Risks / open questions

- **Air-gapped install (UNVERIFIED).** `npx avorelo@latest` needs the package present; exact behavior for
  fully air-gapped / npm-cache-only installs is unspecified. → Define an offline install artifact + doc.
- **Offline key distribution (UNVERIFIED).** How ed25519 public keys / pinned sha256 values reach the
  device and rotate without network trust is not yet specified. → ADR needed.
- **Claim identity model.** Account/identity provider, multi-device claim, and un-claim semantics are
  unspecified. → Open.
- **Sync conflict / replay.** If the same install syncs from multiple contexts, cloud projection ordering
  vs. local ledger ordering needs a rule (local ledger remains authoritative). → Open.
- **Teams governance surface.** Exact sanitized rollup schema and role/approval matrix for the cloud
  dashboard is deferred to the Teams-tier design. → Open.
- **`doctor` probe coverage.** Which hook events `doctor` must observe firing (and how it simulates them
  safely) needs enumeration. → Open.
- **Skill provenance source of truth.** Whether the gstack skills present in this environment are
  Avorelo-native is undecided; treat as `NEEDS_AVORELO_NATIVE_SKILL` until an Avorelo intake pipeline
  exists. (Note: `deep-research` is the only gstack skill that has *run* in this program; others were
  lead-applied or are `NEEDS_AVORELO_NATIVE_SKILL`.)

---

## Skill Review

| Reviewer | Category | Verdict | Basis |
|---|---|---|---|
| deep-research | external-claim verification | PARTIAL | Ran earlier in program; air-gap npm + offline-key claims here remain UNVERIFIED and are flagged, not asserted |
| gstack-cso | security (S2/S3 egress + offline verify) | GO | Sync Boundary single chokepoint, S2 never-cross list explicit, offline signing fail-closed; lead-applied (NEEDS_AVORELO_NATIVE_SKILL) |
| gstack-plan-eng-review | activation determinism / doctor gate | GO | Configured≠validated split + doctor probe directly fix old-repo hooks-not-installed failure; lead-applied (NEEDS_AVORELO_NATIVE_SKILL) |
| gstack-plan-ceo-review | local-first product value | GO | Free core never paywalls safety/truth/recovery; cloud is projection not center; lead-applied (NEEDS_AVORELO_NATIVE_SKILL) |
| gstack-plan-devex-review | activation path friction | PARTIAL | One-command activate to first receipt is clean; air-gap + claim identity gaps reduce confidence; lead-applied (NEEDS_AVORELO_NATIVE_SKILL) |

**Decision:** `LOCAL_CLOUD_ACTIVATION_GO`
