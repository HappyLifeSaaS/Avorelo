# Uninstall Avorelo

## Remove Workspace Data

```bash
avorelo uninstall --target .
```

This removes:
- `.avorelo/` directory (all local data)
- Adapter hooks
- Restores original settings if modified

## Remove Global CLI

If installed from tarball:
```bash
npm uninstall -g avorelo
```

## Manual Cleanup

If the uninstall command is unavailable:
```bash
rm -rf .avorelo
```

## What Is Removed

- Workspace identity
- Activation state
- Settings
- Receipts and proof
- Learning queue
- Adapter hooks

## What Is NOT Removed

- Your project files (source code, etc.)
- Node.js or npm
- Any files outside `.avorelo/`
