# DCO Sign-Off Guide

Avorelo requires a **Developer Certificate of Origin (DCO) 1.1** sign-off on every contributed commit.
This guide explains what that means and how to do it.

## What the sign-off certifies

Adding a `Signed-off-by` trailer certifies the statements in the [DCO](../../DCO): that you wrote the
contribution (or have the right to submit it) and that you agree it may be distributed under the
project's Apache-2.0 license, as a permanent, public part of the Git history.

It is **not** a copyright assignment — you keep your copyright. It is **not** a cryptographic signature.
It is a simple, auditable statement of provenance.

Your **name and email become part of the public Git history**, permanently. Use an identity you are
comfortable publishing (a GitHub noreply address is fine — see below).

## Signing off a commit

```
git commit -s -m "fix: correct the redirect handling"
```

`-s` appends a trailer built from your Git config:

```
Signed-off-by: Your Name <your@email>
```

Set your identity once if you haven't:

```
git config user.name "Your Name"
git config user.email "your@email"
```

## Fixing commits that are missing a sign-off

- **The most recent commit:**
  ```
  git commit --amend --signoff
  ```
- **Several commits on your branch** — rebase and sign off each:
  ```
  git rebase --signoff main
  ```
  (or `git rebase -i` and add `-s` while editing, depending on your Git version). Force-push your topic
  branch afterward.

## You can only sign for yourself

You may not add a `Signed-off-by` for another person. Each contributor signs their own commits.

## Employer permission

If you are contributing work created as part of your employment, make sure you have your employer's
permission to contribute it under Apache-2.0 before signing off.

## GitHub noreply email

To keep a personal address private, enable "Keep my email addresses private" in GitHub settings and use
your GitHub noreply address (`ID+login@users.noreply.github.com`) as your Git `user.email`. The DCO check
accepts it. The check does **not** require the sign-off identity to equal your GitHub login.
