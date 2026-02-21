# Agent Instructions

- When you change any logic, bump the extension version once per pull request (generally patch). This keeps deployments working.
- Before opening a pull request, run all existing checks (lint, format check, typecheck, tests, etc.) and fix any issues so the PR is green.
- Before every PR, run the same checks used by CI (or a strict superset), not ad-hoc approximations.
- Canonical local pre-PR validation command is `npm run verify:ci`; use it unless you have a documented reason to run a strict superset manually.
- Firefox/AMO validation is mandatory for PRs that touch workflows, manifest, build scripts, packaging, or extension assets:
  - Run `npm run build`, `npm run lint:amo`, and `npm run build:amo` (or `npm run verify:ci`, which includes them) using the pinned web-ext toolchain.
  - Keep the pinned web-ext version in sync between `package.json` scripts and `.github/workflows/firefox-amo-sign.yml`.
  - Inspect generated `dist/manifest.json` for correct path normalization (no duplicated `dist/` prefixes, correct background/content script paths).
- Include the exact command list and outcomes in PR notes.
- CI must confirm local validation; CI should not be the first place packaging/lint regressions are discovered.
