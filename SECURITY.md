# Security Policy

Avorelo is a local-first tool. It runs on your machine, keeps your data local, and does not upload
anything automatically. It has no hosted service, no server, and no account system, so most classes of
hosted vulnerability do not apply. Issues in the Avorelo CLI, its local handling of secrets, or its
bundled dependencies are still taken seriously.

## Reporting a vulnerability

**Preferred (once enabled):** GitHub Private Vulnerability Reporting — open the repository's
**Security** tab and choose "Report a vulnerability". If that is not available yet, use the email
channel below; it remains a permanent fallback.

**Email fallback:** report confidentially to
[support@avorelo.com](mailto:support@avorelo.com?subject=Confidential%20Avorelo%20security%20report)
with the subject **`Confidential Avorelo security report`**.

Please:

- **Do not** open a public issue for a suspected vulnerability.
- Include the affected version (`avorelo --version`), the impact, your OS and Node version, and clear
  reproduction steps.
- **Remove secrets, credentials, tokens, personal data, and private source** from your report. A
  minimal, redacted reproduction is enough.

There is **no guaranteed response SLA** unless a separate written services agreement provides one.
Reports are handled on a best-effort basis, with coordinated disclosure once a fix is available.

## Scope note

Avorelo's design keeps source, secrets, logs, environment, diffs, and prompts on your machine. A report
that Avorelo transmits any of these unexpectedly is in scope and high priority.

## Non-security bugs and feedback

For ordinary bugs, questions, and feedback, open a public issue:

- <https://github.com/HappyLifeSaaS/Avorelo/issues>

## Sharing a support bundle

`avorelo support bundle` writes a sanitized, inspectable JSON and Markdown artifact under
`.avorelo/support/`. Nothing is sent anywhere. Review the files first, then attach them yourself only
if you choose to.
