# Provider-Neutral Hooks & Skills Integration

Avorelo exposes CLI commands that any AI coding agent can call. No agent SDK, no provider lock-in.

## Integration surface

| Command | Purpose | Agent Use |
|---------|---------|-----------|
| `npx avorelo status` | Check activation state | Session start |
| `npx avorelo capabilities` | Discover project tools | Before first edit |
| `npx avorelo prove --files <paths>` | Full verification loop | Before closing PR |
| `npx avorelo guard scan` | Artifact guard scan | After edits |
| `npx avorelo verify --command <cmd> --files <paths>` | Work control check | Before risky action |
| `npx avorelo readiness` | Readiness check | Before release |
| `npx avorelo receipt latest` | Latest receipt | Evidence review |
| `npx avorelo doctor` | Health check | Debugging |

## Claude Code integration

Add to `.claude/CLAUDE.md`:
```
Before closing work, run: npx avorelo prove --files <changed-files>
Check result: safeToClose must be true.
```

## Cursor integration

Add to `.cursor/rules`:
```
Run `npx avorelo capabilities` at session start.
Run `npx avorelo prove --files <changed-files>` before marking done.
```

## Codex integration

Add to `AGENTS.md`:
```
Safe commands: npm test, npm run build, npx avorelo prove
Do not run: npm publish, deploy, git push --force
```

## Hook patterns

### Pre-commit hook
```bash
npx avorelo guard scan --ci
```

### Pre-push hook
```bash
npx avorelo readiness --json
```

### CI integration
```yaml
- run: npx avorelo prove --files $(git diff --name-only HEAD~1) --json
```

## Privacy

All CLI commands respect receipt privacy invariants. No raw prompts, source code, or secrets are stored in receipts.
