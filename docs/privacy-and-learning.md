# Privacy

## Local-First

Avorelo runs entirely on your machine. Your source code, secrets, logs,
environment variables, diffs, prompts, and full artifacts stay local. There is
no account, no hosted backend, and no cloud sync.

## No Telemetry, No Learning Uplink

Community Edition collects and transmits **nothing**. There is no usage
telemetry, no "product learning" signal, no analytics, and no background upload.
Normal commands make zero outbound network requests.

Earlier builds had an opt-in "dogfood learning" uplink (`AVORELO_DOGFOOD_*`
environment variables, a local queue, and a send/flush command). That subsystem
has been **removed entirely**. Setting those environment variables has no effect —
nothing is queued, sent, or flushed.

If you have a leftover `.avorelo/learning-queue/` directory from an older build,
it is inert: no code reads it, it triggers no migration and no network activity,
and it affects no routing, safety, or readiness decision. You can delete it at any
time.

## The One Explicit Network Call

The only command that can make a network request is an explicit update check:

```bash
avorelo update-check --target .
```

It performs a single bounded GET to the public npm registry
(`https://registry.npmjs.org/avorelo/latest`) to compare versions. It sends no
project data and follows no redirects.

There is no setting to disable it, because there is nothing running to disable:
update checking only ever happens when you type the command. No preference is
stored and nothing checks in the background.

## Support Bundles Stay Local

`avorelo support bundle` writes a sanitized JSON and Markdown artifact under
`.avorelo/support/`. Nothing is uploaded or attached. Review the files, then
share them yourself via a GitHub issue only if you choose to. Secrets, source,
env values, prompts, logs, diffs, and full artifacts are excluded by
construction.

## View All Settings

```bash
avorelo settings show --target . --json
```
