---
name: GitHub push/branch setup
description: How code reaches GitHub for the cs2-demo-manager repo and the branch strategy that preserves the full version.
---

- Remote `origin` = `https://github.com/ArdianHajdini/Asset-Manager-1.git`. GitHub `main` and `stable` hold the FULL statistics-included version and must be preserved.
- The current working tree is a stripped "demo library + voice commands + folder auto-detect + Gumroad" build (all statistics/scoreboard/radar removed). It belongs on a SEPARATE branch (e.g. `voice-gumroad-stable`), and must NEVER be pushed over `main`.

**Why:** GitHub `main`/`stable` are the only remaining copy of the stats/scoreboard/radar features; overwriting `main` with the stripped build would lose them.

**How to apply / environment constraints:**
- `git commit`, `git config`, and `.git/` writes are blocked by the bash sandbox — you cannot commit yourself.
- The platform creates a checkpoint commit on local `main` AFTER your reply. So a turn's edits are only committed once you yield; you can only `git push` an already-committed state, which means a new-branch push lands the NEXT turn.
- `git push` (non-force) IS allowed. Push a branch without touching main with:
  `git push "https://<PAT>@github.com/ArdianHajdini/Asset-Manager-1.git" main:refs/heads/voice-gumroad-stable` (PAT in `$GITHUB_PERSONAL_ACCESS_TOKEN`). Never print the token.
- `.githooks/post-commit` auto-pushes on commit but is INERT (`core.hooksPath` unset, no `.git/hooks/post-commit`), and cannot be activated since `git config` is blocked. It was repointed from `main` to `main:voice-gumroad-stable` so it can never clobber the full version if ever activated.
