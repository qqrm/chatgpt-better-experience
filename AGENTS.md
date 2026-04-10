# Agent Instructions

## Initialization Policy

- Do not download or bootstrap instruction files via codex-tools.
- Configure environment and instruction files separately for each repository.
- Start each new task in a fresh dedicated worktree (`1 task = 1 branch = 1 worktree = 1 PR`).
- Do not commit private local instruction files from `.codex/`.

## Repository Rules

- Do not manually bump the extension version in `config/extension/manifest.base.json` during PR work; release automation in the Firefox AMO pipeline handles version bumps on `main`.
- Never commit directly to `main`.
- Never push directly to `main`.
- Every change must be developed on a branch prefixed with `codex/` and merged via pull request.
- The expected result for every completed task is an opened pull request from a dedicated `codex/*` branch; do not stop at "branch pushed".
- After opening a pull request, enable GitHub auto-merge so the PR merges automatically once all required CI checks and branch protection rules pass, unless the user explicitly asks not to or the PR is intentionally left in a non-mergeable state.
- Parallel execution in a single working directory is forbidden.
- Mandatory model: **1 task = 1 branch = 1 worktree = 1 pull request**.
- Use `git worktree` for task isolation: each new user task must run in a dedicated worktree directory.
- Standard task worktree naming: `<repo-parent>\\wt\\<repo-name>-<task-slug>`.
- One agent must own exactly one task worktree, one `codex/*` branch, and one pull request.
- For each new user task, create a fresh `codex/*` branch and worktree before making any file changes.
- Before every new task, first sync local `main` with remote `origin/main`: `git fetch origin && git pull --ff-only origin main`.
- Task start flow: in the primary checkout on the chosen base branch (`main` or `dev`), run `git fetch origin && git pull --ff-only origin <base-branch>`, then create the task worktree from `origin/<base-branch>`.
- Canonical task setup command: `git worktree add <standard-worktree-path> -b codex/<task-slug> origin/<base-branch>`.
- Run edits, checks, commits, and pushes only from the task's dedicated worktree.
- The primary checkout is reserved for syncing the base branch and creating/removing worktrees; do not run task edits, builds, tests, commits, or pushes there.
- Before every push from a task worktree, run `git fetch origin`, rebase onto `origin/<base-branch>`, and if the remote task branch has moved, rebase onto that upstream branch before pushing.
- Resolve all rebase conflicts locally before any push; CI must not be the first place conflicts are discovered.
- Use `--force-with-lease` only on your own task branch when a local rebase rewrites published commits.
- Canonical helper scripts for this workflow: `scripts/task-start.ps1` and `scripts/task-finish.ps1`.
- Canonical start command: `pwsh -File scripts/task-start.ps1 -Task "<task-slug>" -BaseBranch <main|dev>`.
- Canonical finish command: `pwsh -File scripts/task-finish.ps1 -BaseBranch <main|dev>`.
- After task completion/merge, clean up with `git worktree remove <path>` (and delete the task branch when appropriate).
- Before opening a pull request, run all existing checks (lint, format check, typecheck, tests, etc.) and fix any issues so the PR is green.
- If any local check fails, fix the underlying issue in the same PR so all required checks are green before creating/updating the PR.
- Before every PR, run the same checks used by CI (or a strict superset), not ad-hoc approximations.
- Canonical local pre-PR validation command is `npm run verify:ci`; use it unless you have a documented reason to run a strict superset manually.
- PR description format is mandatory: `Summary`, `Validation`, `Notes` (in this order), following `.github/pull_request_template.md`.
- In `Validation`, list exact commands in backticks with explicit status (`passed`, `failed`, or `skipped`).
- Firefox/AMO validation is mandatory for PRs that touch workflows, manifest, build scripts, packaging, or extension assets:
  - Run `npm run build`, `npm run lint:amo`, and `npm run build:amo` (or `npm run verify:ci`, which includes them) using the pinned web-ext toolchain.
  - Keep the pinned web-ext version in sync between `package.json` scripts and `.github/workflows/firefox-amo-sign.yml`.
  - Inspect generated `dist/manifest.json` for correct path normalization (no duplicated `dist/` prefixes, correct background/content script paths).
- Prefer official or well-maintained community GitHub Actions for CI/CD tasks over custom scripts; add custom scripting only when no reliable action exists and document the reason in the PR notes.
- Include the exact command list and outcomes in PR notes.
- CI must confirm local validation; CI should not be the first place packaging/lint regressions are discovered.

## Isolated Firefox Validation Stand

- This repository has a built-in isolated Firefox validation stand for live extension checks. Use it by default for browser validation instead of opening or controlling Firefox on the host desktop.
- Prefer the VM-based stand first: `npm run firefox:vm`. It launches an Ubuntu guest on Hyper-V through Multipass, mounts the repo into the guest, and runs Firefox there.
- Use `npm run firefox:vm:status` to obtain the current SSH command, noVNC URL, and guest mount path. Do not hardcode IP addresses or assume a previous VM is still running.
- Use `npm run firefox:vm:screenshot` when a visual checkpoint is enough and avoid taking over the host desktop.
- Use the container stand only as a fallback or for narrower runtime checks: `npm run firefox:dev`, `npm run firefox:dev:status`, `npm run firefox:dev:screenshot`.
- Docs for the stand live in `docs/multipass-firefox-debug.md` and `docs/container-firefox-debug.md`. Follow those command paths instead of inventing a new local browser setup.
- Do not launch or automate the user's main browser profile when the isolated stand can cover the task.
- Live ChatGPT validation may still require a logged-in session inside the isolated browser. If the site is blocked externally in the stand (for example `Unable to load site` or a Cloudflare challenge), state that explicitly instead of silently switching to the host browser.

## Shared Local RAG (CBE)

- Use only the external multi-repo RAG service at `B:\repos\multi-repo-rag`.
- Do not create or commit `tools/repo-rag` inside this repository.
- Register this repository in the shared service with `repo_id: cbe`.
- `repo_path` may point to the primary checkout or an active worktree for this repo.
