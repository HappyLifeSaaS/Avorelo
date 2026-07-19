# Canonical Activation Slice — Architecture

## Flow

```
Workspace Context Snapshot
→ Activation Intent Classification (default = local-first/free)
→ Safe Local Activation Runner (no hooks, no network, no billing)
→ Local State Writer (.avorelo/activation/activation-state.json)
→ Receipt Writer (.avorelo/receipts/rcpt_canonical_activation.json)
→ SkillOutput Emitter (activation-state, activation-command, etc.)
→ Status/Open/Dashboard Reader (reads activation state + receipts)
→ Founder/Admin Truth (consumes SkillOutputs + activation state)
→ Company Loop Consumption (personas update based on activation evidence)
→ Dogfood/Verification (activation:verify validates state invariants)
```

## Contract

```typescript
type AvoreloActivationStateV1 = {
  contract: "avorelo.activationState.v1";
  workspaceId: string;
  repoIdentity: {
    root: string;
    gitDetected: boolean;
    remote?: string | null;
    branch?: string | null;
  };
  activatedAt: string;
  updatedAt: string;
  activationMode: "local-first/free";
  activationStatus: "not_started" | "active" | "active_with_holds" | "blocked" | "corrupt_state";
  setupSteps: Array<{
    id: string;
    label: string;
    status: "passed" | "fixed" | "hold" | "blocked";
    evidencePath?: string;
    reason?: string;
  }>;
  holds: string[];
  blockers: string[];
  nextAction: { label: string; command?: string; reason: string };
  localDashboard: { available: boolean; path?: string };
  receipts: Array<{ id: string; path: string; type: string }>;
  billing: {
    provider: "lemon_squeezy";
    billingLive: false;
    checkoutConfigured: false;
    webhookConfigured: false;
    status: "HOLD_NOT_LIVE";
  };
  cloud: {
    authLive: false;
    cloudSyncLive: false;
    status: "HOLD_NOT_LIVE";
  };
  productionReady: false;
  redacted: true;
};
```

## Canonical Write Paths

```
.avorelo/activation/activation-state.json   — activation state (this slice)
.avorelo/receipts/**                         — redacted receipts
.avorelo/events/**                           — hook fire log (if hooks installed)
.avorelo/internal/**                         — feedback signals, work ledger
.avorelo/dashboard/**                        — generated local dashboard HTML
.avorelo/site/**                             — generated static site
```

## Commands

| Command | What it does | Hooks? | Network? | Billing? |
| ------- | ------------ | ------ | -------- | -------- |
| `avorelo activate` | Detect workspace, write activation state, create receipt | NO | NO | NO |
| `avorelo activate --install-hooks --approve` | Above + install Claude Code lifecycle hooks | YES (explicit) | NO | NO |
| `avorelo status` | Read and display activation state | NO | NO | NO |
| `avorelo open` | Generate/display local receipt dashboard | NO | NO | NO |
| `avorelo doctor` | Health check (hooks + write probe) | Reads hooks | NO | NO |
| `activation:verify` | Validate activation state invariants | NO | NO | NO |

## Not Allowed

- Global config writes
- Production secrets
- Live billing or checkout
- Live auth
- Cloud sync
- Deploy settings
- npm publish config
- External service reconnection
- Hidden network calls
- Raw prompts/logs/secrets in state or receipts
