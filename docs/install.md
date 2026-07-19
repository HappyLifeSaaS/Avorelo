# Install Avorelo

## Requirements

- Node.js >= 24 ([download](https://nodejs.org))

## From Source Checkout

```bash
git clone <repo-url>
cd avorelo
npm install
npm run build
```

Run directly from source:
```bash
node src/avorelo/surfaces/cli/avorelo.ts --version
node src/avorelo/surfaces/cli/avorelo.ts init --target .
```

Or use the npm script:
```bash
npm run cli:local -- --version
npm run cli:local -- init --target .
```

## From Tarball

```bash
npm pack
npm install -g ./avorelo-0.0.1-alpha.1.tgz
avorelo --version
```

## Verify Installation

```bash
avorelo --version
avorelo --help
avorelo init --target .
avorelo status --target .
```

## What Gets Installed

The package contains 5 files:
- `bin/avorelo.mjs` — CLI entry point
- `dist/avorelo.mjs` — bundled application (~535kb)
- `package.json` — package metadata
- `README.md` — documentation
- `LICENSE` — license terms
