# Getting Started with Avorelo

Avorelo is AI Work Control software. It runs locally around your AI coding tool — it does not generate code. It keeps work focused, keeps secrets out of the model and out of cloud, and saves proof of what actually happened.

## Requirements

- Node.js >= 24

## Install

### From source checkout (recommended)

```bash
git clone <repo-url>
cd avorelo
npm run build
```

Run the CLI:
```bash
node src/avorelo/surfaces/cli/avorelo.ts --version
node src/avorelo/surfaces/cli/avorelo.ts --help
```

### From local tarball

```bash
npm pack
npm install -g ./avorelo-0.0.1-alpha.1.tgz
avorelo --version
```

## First Commands

No signup, no cloud account, no network required.

```bash
# 1. Initialize a local workspace
avorelo init --target .

# 2. Check workspace status
avorelo status --target .

# 3. Run a focused work session
avorelo run "your task here" --target .

# 4. View local state
avorelo control-center --target .
```

## What Avorelo Creates Locally

All data lives under `.avorelo/` in your project directory:

- `workspace.json` — workspace identity
- `activation.json` — activation state
- `settings.json` — your settings
- `receipts/` — work receipts and proof
- `support/` — sanitized support bundles you create with `avorelo support bundle` (local only)

Nothing is sent anywhere without your explicit action.

## Next Steps

- [Install details](install.md)
- [Privacy](privacy-and-learning.md)
- [Troubleshooting](troubleshooting.md)
- [Update](update.md)
- [Uninstall](uninstall.md)
