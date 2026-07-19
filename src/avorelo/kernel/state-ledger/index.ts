// Avorelo State/Event Ledger (Slice 1). Append-only, hash-chained, deterministic fold + replay (ADR-1).
// The single state store. Current state is reduce(events). Owns no policy/proof — it stores events.

import { createHash } from "node:crypto";
import { redact } from "../../shared/redaction/index.ts";
import type { LedgerEvent } from "../../shared/schemas/index.ts";

/**
 * Deep, deterministic stringify: recursively sorts object keys at EVERY level so the hash is stable
 * across equivalent key orderings AND covers all nested content. (The previous replacer-array form of
 * JSON.stringify used the key list as a recursive ALLOWLIST and silently dropped nested payload keys,
 * so nested tampering was invisible to the hash. This fixes that.)
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

function hashEvent(parts: Record<string, unknown>): string {
  // Hash the FULL event deterministically (nested payload included) — integrity covers everything.
  return createHash("sha256").update(stableStringify(parts)).digest("hex");
}

export type AppendInput = {
  type: string;
  contractId: string | null;
  payload: Record<string, unknown>;
  reasonCodes?: string[];
  ts?: number; // injectable clock for deterministic tests
};

export class StateLedger {
  private events: LedgerEvent[] = [];

  append(input: AppendInput): LedgerEvent {
    const seq = this.events.length;
    const prevHash = seq === 0 ? "GENESIS" : this.events[seq - 1].eventHash;
    // Redaction runs BEFORE hashing so the chain is verifiable without secrets (S2).
    const payload = redact(input.payload).value;
    const ts = input.ts ?? Date.now();
    const reasonCodes = input.reasonCodes ?? [];
    const core = { seq, ts, type: input.type, contractId: input.contractId, payload, reasonCodes, prevHash };
    const eventHash = hashEvent(core);
    const event: LedgerEvent = {
      eventId: `${seq}:${eventHash.slice(0, 12)}`,
      ...core,
      eventHash,
      redacted: true,
    };
    this.events.push(event);
    return event;
  }

  all(): LedgerEvent[] {
    return this.events.slice();
  }

  /** Deterministic fold: same events -> same state, every time (replay). */
  fold<S>(reducer: (state: S, event: LedgerEvent) => S, initial: S): S {
    return this.events.reduce(reducer, initial);
  }

  /** Verify the hash chain is intact (tamper-evident). */
  verifyChain(): boolean {
    let prev = "GENESIS";
    for (const e of this.events) {
      if (e.prevHash !== prev) return false;
      const core = {
        seq: e.seq,
        ts: e.ts,
        type: e.type,
        contractId: e.contractId,
        payload: e.payload,
        reasonCodes: e.reasonCodes,
        prevHash: e.prevHash,
      };
      if (hashEvent(core) !== e.eventHash) return false;
      prev = e.eventHash;
    }
    return true;
  }
}

/** Rebuild a ledger from a prior event list (replay) and re-fold — used to prove determinism. */
export function replayFold<S>(events: LedgerEvent[], reducer: (s: S, e: LedgerEvent) => S, initial: S): S {
  return events.reduce(reducer, initial);
}
