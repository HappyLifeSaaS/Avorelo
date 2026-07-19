# Model and Primitive Routing

**Status:** ACTIVE | **Date:** 2026-06-09

---

## Core Principle
Avorelo routes the work, not only the model. Deterministic-first.

## Primitives
no_action, no_connect, deterministic_local_read, deterministic_local_script,
built_in_scanner, scanner_adapter, internal_skill, manual_checklist,
llm_model_profile, mcp_tool, browser_workflow, direct_api,
human_approval, stop_blocked, prepare_next_run_packet

## Model Profiles
none, cheap_classification, standard_synthesis, high_reasoning,
code_generation, security_sensitive_review, privacy_sensitive_summary, fallback_only

## Rules
1. Deterministic-first when sufficient
2. No-connect is a positive routing decision
3. Security/proof/entitlement/READY stays deterministic
4. Model allowed for synthesis/classification/generation — not final authority
5. Model output cannot own READY/entitlement/payment truth
6. External writes require approval
7. Token/cost optimization cannot override proof/security