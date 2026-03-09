# Agent Instructions

This repository uses manually maintained local instructions.

## Instruction Load Order

1. Apply repository overrides from `REPO_AGENTS.md` when the file exists.
2. Apply additional scoped `AGENTS.md` files in subdirectories when present.

## Initialization Policy

- Do not download or bootstrap instruction files via codex-tools.
- Configure environment and instruction files separately for each repository.
- Start each new task in a fresh dedicated worktree (`1 task = 1 branch = 1 worktree = 1 PR`).
- Do not commit private local instruction files from `.codex/`.
