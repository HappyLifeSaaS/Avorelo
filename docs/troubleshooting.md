# Troubleshooting

## Diagnostic Commands

```bash
avorelo doctor --target .          # Health check
avorelo verify --target .          # State invariant validation
avorelo status --target . --json   # Workspace status
avorelo support bundle --target .  # Create debug bundle
```

## Common Issues

### Command not found
- **Tarball install:** `npm install -g ./avorelo-0.0.1-alpha.1.tgz`
- **Source checkout:** `node src/avorelo/surfaces/cli/avorelo.ts --version`

### Node.js version too old
Avorelo requires Node.js >= 24. Check with `node --version`.

### Build fails
```bash
npm install
npm run build
```

### Workspace corrupted
```bash
rm -rf .avorelo
avorelo init --target .
```

### Update check fails
Network may be unavailable — this is expected for offline use. Source checkouts update manually via `git pull`.

## Reporting Issues

Include:
- `avorelo --version`
- `node --version`
- Operating system
- Install method
- `avorelo doctor --target .` output

Do NOT include:
- `.env` files
- API keys, tokens, or secrets
- Raw logs with sensitive content
