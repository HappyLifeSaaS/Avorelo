# Security & Privacy

Avorelo is an **AI Work Control Kernel**. It runs locally and is designed to keep your work safe while you
keep using your AI coding tool.

## How Avorelo protects secrets

- **Avorelo is designed to keep secrets out of AI context.** It detects credential-shaped content and
  redacts it before it reaches the model.
- **Avorelo detects common credential patterns** — private keys, cloud and API tokens, webhook secrets,
  database URLs with passwords, and environment secret assignments.
- **Avorelo redacts sensitive tool output before it reaches model context where supported.** Detected
  values are replaced with a coded marker; the model sees a safe reference, never the value.
- **Avorelo blocks risky secret-exfiltration flows** — commands or tasks that try to print, dump, or send
  secrets are blocked or held for your approval before they run.
- **Avorelo stores only redacted local receipts.** Receipts record what happened using codes, counts, and
  safe references — never raw secrets, prompts, source, environment values, terminal logs, or diffs.
- **Cloud sync uses sanitized, allowlist-only metadata.** Only explicitly safe fields ever leave your
  machine, and only after redaction.

## What Avorelo is not

Avorelo is a safety boundary, not a secrets product. To be clear about scope:

- Avorelo does not store or manage your secrets, and it is not a vault.
- Avorelo does not rotate credentials. When a secret is exposed, Avorelo gives you a manual remediation
  checklist; rotating the credential with your provider is a step you take.
- Avorelo reduces the risk of secret exposure deterministically. It does not make guarantees about every
  possible case, and it is not a replacement for dedicated secret-management or code-scanning tools.

## Local-first by default

Everything runs on your machine. Nothing is sent to the cloud unless you link a workspace and choose to
sync, and even then only sanitized, allowlist-only metadata is sent.
