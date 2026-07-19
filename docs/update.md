# Updating Avorelo

Update checking is **explicit only**. Avorelo never checks for updates in the background, stores no
update preference, and never mutates your working tree.

## Check for updates

```bash
avorelo update-check --target . --json
```

This is the only command that contacts the network for updates. It performs a single bounded `GET` to
the fixed public npm registry URL (`https://registry.npmjs.org/avorelo/latest`) to compare versions —
no payload, no redirects, no identifying data. If the network is unavailable it reports `unavailable`
honestly and writes no cache or state.

There is no automatic check to disable, no update channel, and no update preference: it happens only
when you type the command.

## Applying an update

Avorelo does not update itself. Apply an update yourself:

### Source checkout

```bash
git pull
npm ci
npm run build
```

### Published package

Once the Community Edition build is published to npm:

```bash
npx avorelo@latest        # run the latest without installing
npm install -g avorelo@latest
avorelo --version
```

(The versions currently on npm predate the Community Edition architecture — see the README status note.)

## View current settings

```bash
avorelo settings show --target . --json
```
