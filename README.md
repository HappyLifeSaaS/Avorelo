# Avorelo

**AI Work Control.** Avorelo runs *around* your AI coding tool. It does not generate code — it keeps the
work focused, keeps secrets out of the model, and saves proof of what actually happened, locally.

> **Status.** Avorelo is **Open Source** under the **Apache License 2.0**, local-first by design. The
> earlier hosted service (accounts, cloud sync, billing) was **discontinued** — the CLI needs no account,
> no billing, and no cloud backend. Personal, internal, organizational, and commercial use are all
> permitted under Apache-2.0 (see [License](#license)). Stable release `1.0.0`.

## What it is

A bundled Node CLI that runs entirely on your machine. No signup, no account, no database, no server.
All state is local JSON under `.avorelo/` in your project.

## Install

```
npm install -g avorelo
avorelo --help
```

Or run from a local checkout:

```
npm ci
npm run build
node src/avorelo/surfaces/cli/avorelo.ts --help
```

Requires Node.js >= 24. Zero runtime dependencies.

## Quickstart

```
avorelo activate --target .          # detect your project and set up local state
avorelo status --target .            # workspace state and the next command
avorelo run "run tests" --target .   # start a focused work session
avorelo control-center --target .    # read-only local view of all local state
```

`activate` writes only local metadata under `.avorelo/` — no source, env, or secrets.
`status` always tells you the next command.

## What a run does

```
avorelo run "fix the login redirect bug in src/auth" --target .
```

1. **Routes** the task through a deterministic **Secret Boundary** — a pasted credential is detected and
   never printed, persisted, or sent to the model; an unsafe task is blocked.
2. Starts a **session** around whatever AI coding tool you already use.
3. Compiles a **bounded, source-aware context** (references, never raw dumps).
4. Carries forward **next-run continuity** so the next session resumes safely.
5. Records **token & cost evidence** — honestly labelled `measured` / `imported` / `estimated` /
   `inferred` / `unavailable`. Unavailable is never reported as zero, and numbers are never fabricated.
6. Builds a **proof report** — savings are **refused** unless there is comparative evidence.
7. Updates a **value ledger** of compact, confidence-labelled cards.

## Commands

| Command | What it does |
|---|---|
| `avorelo activate` | Detect, repair, install run-entry guidance; write local activation state |
| `avorelo status` | Activation + session status, and the next command |
| `avorelo run "<task>"` | The focused work session above |
| `avorelo resume` | Resume an interrupted session |
| `avorelo control-center` | Read-only local view of all session/proof/value state |
| `avorelo open` | Local receipts dashboard (html/json/text) |
| `avorelo doctor` | Health check (adapters, hooks, session) |
| `avorelo report build` · `avorelo value cards` | Proof report · value cards |
| `avorelo context check` · `avorelo context status` | Agent context integrity / freshness |
| `avorelo loop check "<task>"` · `loop start` · `loop status` | Bounded AI loop |
| `avorelo browser qa run` | Explicit, user-directed Browser Visual QA (see below) |
| `avorelo support bundle` | Write a sanitized local support bundle |
| `avorelo update-check` | Explicit update check against the public npm registry |
| `avorelo settings show` · `settings reset` | Local settings (no automatic-update preference exists) |
| `avorelo uninstall` | Remove all Avorelo-managed content |
| `avorelo --help` | Full command list |

Run `avorelo --help` for the complete, authoritative surface.

## Where your data lives

Everything is local, under `.avorelo/` in your project:

- `workspace.json`, `activation/` — workspace identity and activation state
- `settings.json` — local settings
- `receipts/` — work receipts and proof
- `support/` — sanitized support bundles you create yourself

Nothing is uploaded. Delete the directory (or run `avorelo uninstall`) to remove it.

## Privacy and network model

Ordinary local operation makes **zero outbound network requests** — activation, status, doctor, run,
resume, hooks, the viewer, Control Center, receipts, context and proof all work fully offline. There is
no telemetry, no usage reporting, no account, and no cloud receipt upload.

Exactly two paths can produce a request, and neither sends project data to an Avorelo-operated origin:

- **Explicit update check** — `avorelo update-check` performs one bounded `GET` to the fixed public npm
  registry URL (`https://registry.npmjs.org/avorelo/latest`) to compare versions. No payload, no
  redirects, no identifying data. It is never automatic.
- **Explicit Browser Visual QA** — `avorelo browser qa run` launches a headless browser (requires
  Playwright) against a **local** target by default, served over a `127.0.0.1` loopback server. It
  contacts an external host only if *you* pass an explicit `--target` URL that clears the safety policy.
  It uploads nothing and contacts no Avorelo endpoint.

Printing a link (GitHub, npm, docs) is not a network request — nothing opens automatically.

See [Privacy](docs/privacy-and-learning.md).

## Support and contact

`avorelo support bundle` writes a sanitized, allowlisted JSON + Markdown artifact under
`.avorelo/support/`. Secrets, source, env values, prompts, logs and diffs are excluded by construction.
Nothing is sent — review the files, then attach them yourself only if you choose to.

- **General support:** [support@avorelo.com](mailto:support@avorelo.com?subject=Avorelo%20support) · see [SUPPORT.md](SUPPORT.md)
- **Bugs and questions:** https://github.com/HappyLifeSaaS/Avorelo/issues
- **Optional paid services:** [support@avorelo.com](mailto:support@avorelo.com?subject=Avorelo%20services%20inquiry) · see [COMMERCIAL-SERVICES.md](COMMERCIAL-SERVICES.md)
- **Security:** [SECURITY.md](SECURITY.md) (GitHub private reporting, with email fallback)

Apache-2.0 already grants your rights to use Avorelo; paid services are optional and separate.

## Architecture

Local-first by construction:

- a bundled Node CLI (`dist/avorelo.mjs`), zero runtime dependencies
- local filesystem state under `.avorelo/`; local receipts and evidence
- local Control Center / dashboard / viewer; local loopback preview server
- explicit Browser Visual QA; local support bundle
- a static public website (Netlify)
- **no** API server, auth, database, billing, cloud sync, or telemetry upload

Package boundary: runtime dependencies **zero**; devDependencies **esbuild** and **tsx**; the npm tarball
ships exactly `LICENSE`, `NOTICE`, `README.md`, `bin/avorelo.mjs`, `dist/avorelo.mjs`, `package.json`.

See [docs/architecture](docs/architecture/).

## Contributing

Contributions are **welcome** — see [CONTRIBUTING.md](CONTRIBUTING.md). Ordinary contributions require a
[DCO](DCO) sign-off (`git commit -s`) but **no CLA**. Local development needs only Node and npm — no
database, no credentials, no environment configuration:

```
npm ci              # esbuild + tsx only
npm run build       # bundle the CLI
npm run test:local  # full local test suite
npm run dogfood:all # deterministic local dogfood suite
npm run build:site && npm run site:check
```

See [docs/development](docs/development/).

## Requirements

Node.js >= 24.

## License

**Apache License 2.0.** Copyright 2026 Benjamin Persky. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE);
`package.json` declares `"license": "Apache-2.0"`.

Avorelo is **Open Source**. Apache-2.0 permits personal, internal, organizational, and commercial use,
including modification and redistribution, subject to the license terms (preserve copyright/license/
NOTICE, state significant changes, etc.). No fee and no separate license are required to use it. Optional
paid services are separate — see [COMMERCIAL-SERVICES.md](COMMERCIAL-SERVICES.md). Avorelo is not
affiliated with or endorsed by the Apache Software Foundation.
