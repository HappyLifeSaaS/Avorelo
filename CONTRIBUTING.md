# Contributing to Avorelo

**Contributions are welcome.** Avorelo is Open Source under the Apache License 2.0, and code, tests,
documentation, accessibility, performance, and design improvements are all appreciated.

## 1. Welcome

Thanks for your interest. Avorelo is a local-first CLI; it runs entirely on the developer's machine with
no account, backend, or telemetry. Contributions that keep it fast, honest, and local are the most
valuable.

## 2. Types of contribution

Bug fixes, features, tests, documentation, accessibility fixes, performance work, and design
improvements.

## 3. Discuss substantial changes first

For anything beyond a small fix, **open an issue first** so the approach can be agreed before you invest
time. Small, obvious fixes can go straight to a pull request.

## 4. Fork and branch workflow

Fork the repository, create a topic branch, make your change, and open a pull request against the default
branch.

## 5. Local setup

```
npm ci               # esbuild + tsx only; no database, no credentials
npm run build
npm run test:local
npm run dogfood:all
npm run build:site && npm run site:check
```

Node.js >= 24. There is nothing to provision — no DB, no environment configuration.

## 6. Coding and documentation expectations

Match the surrounding code's style and idioms. Keep changes focused. Documentation should stay accurate
to what the code actually does — no aspirational claims.

## 7. Required checks

Your pull request must pass CI: build, tests (`test:local`), dogfood suite, site checks, the licensing
and contribution truth gates, and the **DCO check**.

## 8. Developer Certificate of Origin (DCO) sign-off — required

Every commit in a pull request must carry a `Signed-off-by` trailer certifying the
[Developer Certificate of Origin 1.1](DCO):

```
git commit -s -m "your message"
```

`-s` appends `Signed-off-by: Your Name <your@email>` using your Git `user.name`/`user.email`. See the
[DCO sign-off guide](docs/contributing/dco-guide.md) for amending, rebasing, and using a GitHub noreply
address. The sign-off certifies you have the right to submit the contribution; it is **not** a copyright
assignment and **not** a cryptographic signature.

## 9. Contribution license (Apache-2.0)

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in Avorelo
is submitted under the Apache License 2.0, consistent with Section 5 of that license.

Every commit in a pull request must include a Signed-off-by trailer confirming compliance with Developer
Certificate of Origin 1.1.

**No CLA is required for ordinary contributions.**

## 10. Third-party code and provenance

Only submit code you have the right to contribute. Do not paste proprietary, employer-owned, or
incompatibly licensed (e.g. GPL/AGPL) code into Avorelo. If you include third-party material that is
compatibly licensed, preserve its license and attribution and note it in your pull request.

## 11. No secrets or customer data

Never include secrets, credentials, tokens, or customer/personal data in code, tests, fixtures, or
issues.

## 12. Security issues

Do not report vulnerabilities in a public issue or pull request. Follow [`SECURITY.md`](SECURITY.md).

## 13. Review process

A maintainer reviews pull requests. Expect questions and requested changes; reviews are best-effort.

## 14. Maintainer discretion

Maintainers may decline or defer a change that doesn't fit the project's scope or direction, even if it
is well-made. Opening an issue first reduces the chance of this.

## 15. Exceptional contributions

A separate agreement (CLA, corporate authorization, or software grant) may be requested **only** for an
exceptional contribution with substantial complexity — a large imported codebase, a substantial
pre-existing project, material employer ownership, unclear copyright, significant patent implications, or
a one-off relicensing/software-grant need. **This exceptional process never applies to, or blocks,
ordinary pull requests.**
