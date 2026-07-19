// Avorelo Capability-Collision Registry (Slice 1, S5). Enforces THE ONE RULE:
// every Kernel concern has exactly ONE owner. Registering a second owner for a concern throws (fail-closed).

export type Concern =
  | "policy"
  | "evidence"
  | "receipts"
  | "approval"
  | "work-controls"
  | "stop-continue-gate"
  | "state-ledger"
  | "redaction"
  | "routing"
  | "runtime-boundary"
  | "sync-boundary";

export class OwnershipRegistry {
  private owners = new Map<string, string>();

  register(concern: Concern | string, owner: string): void {
    const existing = this.owners.get(concern);
    if (existing && existing !== owner) {
      throw new Error(
        `CAPABILITY_COLLISION: concern "${concern}" already owned by "${existing}"; "${owner}" may not also own it (THE ONE RULE).`,
      );
    }
    this.owners.set(concern, owner);
  }

  ownerOf(concern: string): string | undefined {
    return this.owners.get(concern);
  }

  /** Startup/CI check: returns the list of concerns and their single owners. Throws nothing if clean. */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.owners.entries());
  }
}

/** The canonical Slice-1 ownership wiring — one owner per concern. */
export function buildKernelRegistry(): OwnershipRegistry {
  const r = new OwnershipRegistry();
  r.register("policy", "kernel/policy");
  r.register("evidence", "kernel/evidence");
  r.register("receipts", "kernel/receipts");
  r.register("work-controls", "kernel/work-controls");
  r.register("stop-continue-gate", "kernel/stop-continue-gate");
  r.register("state-ledger", "kernel/state-ledger");
  r.register("redaction", "shared/redaction");
  r.register("routing", "kernel/work-controls");
  r.register("runtime-boundary", "kernel/runtime-boundary"); // Slice 2
  return r;
}
