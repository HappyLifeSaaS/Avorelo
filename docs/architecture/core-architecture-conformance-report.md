# Core Architecture Conformance Report

**Date:** 2026-06-09

## Architecture Rules Verified

| # | Rule | Status | Evidence |
|---|---|---|---|
| 1 | Kernel owns final decisions | PASS | stop-continue-gate is sole READY decider; capability-collision tests |
| 2 | Capabilities assemble, not decide | PASS | production-confidence calls kernel; payment-readiness calls kernel |
| 3 | Adapters connect, never decide entitlement | PASS | lemon-squeezy adapter is env-driven, offline-safe |
| 4 | Surfaces project, not invent | PASS | local-dashboard reads receipts only; public web is static |
| 5 | Dashboard not source of truth | PASS | dashboard.redaction=applied; core dogfood confirms |
| 6 | Payment redirect not entitlement | PASS | 12 payment tests; core dogfood confirms |
| 7 | Old repo is source material only | PASS | migration inventory classifies 85+ capabilities |
| 8 | Migration selective and governed | PASS | scorecard validates owner+mode+proof per candidate |
| 9 | Claims are labelled | PASS | dogfood labels all measurements as measured/estimated/inferred |
| 10 | No raw secrets/prompts in receipts | PASS | redaction tests; core dogfood: 0 leaks |
| 11 | No duplicate truth system | PASS | dashboard route audit: 2 surfaces, different purposes |
| 12 | No fake auth/payment/cloud | PASS | no production secrets; login/signup are placeholders |
| 13 | No token-savings-first positioning | PASS | approved hero verified; old hero absent |
| 14 | No surveillance framing | PASS | Teams = waitlist; no developer ranking |