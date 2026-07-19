# Avorelo Security & Trust

**Status: DRAFT** | Last updated: 2026-06-13

---

## How Avorelo handles your data

Avorelo Community Edition is a local-first AI work control CLI. Your data stays on your machine: ordinary local operation makes no outbound network request at all.

This page explains what we never collect (everything), and how the system is built to keep your secrets out of places they do not belong.

---

## Local-first architecture

Avorelo runs on your machine. Your workspace files, source code, environment variables, and project state stay local. There are no servers to send anything to.

When you use Avorelo's core workflow — task tracking, session control, agent adapters — all processing happens locally. There is no background telemetry, no silent uploads, no "phone home" behavior.

---

## The secret boundary

Avorelo includes a secret boundary layer designed to prevent accidental leakage of sensitive values.

How it works:

- **Allowlist validator**: Every outbound payload passes through an allowlist-based validator. Only explicitly permitted data categories can leave your machine. Everything else is blocked by construction — the system does not try to detect secrets and filter them out; instead, it only allows through data that matches known-safe patterns.
- **No regex guessing**: We do not rely on regex pattern matching to "find and redact" secrets. The boundary works in the opposite direction: nothing passes unless it is on the allowlist.
- **Tested**: The secret boundary is covered by dedicated tests in the local suite (`npm run test:local`).

This approach is not perfect — no system is — but it is structurally conservative. The default is to block, not to allow.

---

## What we never collect

Regardless of your settings, Avorelo never collects:

- Passwords or authentication tokens
- Health or medical information
- Financial data (bank accounts, investment details)
- Biometric data
- Social Security numbers or government-issued IDs
- Payment card numbers
- Source code
- Environment variables or `.env` file contents
- Raw logs
- Git diffs
- Raw prompts or prompt history

These categories are excluded by design, not by policy. The secret boundary's allowlist does not include patterns for any of these data types.

---

## What we collect with opt-in

Nothing. Community Edition has no opt-in collection because it has no collection at all:
there is no telemetry, no usage reporting, no "learning signal", and no account. Earlier
builds had an opt-in learning uplink; that subsystem has been **removed entirely**, and the
environment variables that once enabled it now have no effect.

---

## Infrastructure

Avorelo Community Edition has **no server-side components**, so it has no infrastructure
subprocessors: no application hosting, no database, and no billing provider. The CLI runs
only on your machine and writes only to `.avorelo/` in your project.

The single remaining hosted dependency of the *project* is the static public website, served
by Netlify. It carries no user data from the CLI.

---

## Testing

Avorelo's codebase carries a large deterministic local test suite (see `npm run test:local`). It covers:

- Core workflow logic (task state, session control, agent adapters)
- The secret boundary and allowlist validator
- Support-bundle allowlisting and redaction
- The outbound-network boundary (zero egress for normal local operations)

We run the full test suite on every change before merge.

---

## Incident response

If you discover a security issue, or believe your data may have been exposed:

- Follow [SECURITY.md](../../SECURITY.md) — use the repository's private vulnerability reporting if it is enabled, and do not disclose details in a public issue
- We will acknowledge receipt and begin investigation promptly

We are a small team. We do not have a 24/7 security operations center. What we do have is direct access to the person who built the system and can act on issues quickly.

---

## What we do not claim

We want to be honest about where we are:

- We are **not** SOC 2 certified
- We are **not** ISO 27001 certified
- We do **not** claim GDPR compliance (we are working toward it; see our draft DPA)
- We do **not** claim zero data leakage — no system can guarantee that
- We are **not** an enterprise-grade security product

We are a small, early-stage product that takes security seriously and has built structural safeguards (local-first, allowlist boundary, no silent collection) into the architecture from the start.

---

*This document is a draft and will be updated as the product and its security posture evolve.*
