# ChatGPT Better Experience

Firefox extension that adds quality-of-life features to ChatGPT/Codex.

Install: https://addons.mozilla.org/en-US/firefox/addon/chatgpt-better-expierience/

Docs: see [docs/README.md](docs/README.md)

Dev:

- `npm ci`
- `npm run verify`
- `npm run build`
- `npm run firefox:dev` for isolated containerized Firefox extension debugging
- `npm run firefox:vm` for isolated Firefox debugging inside a Hyper-V Ubuntu VM via Multipass
- `npm run firefox:vm:rustdesk` for the same VM stand with RustDesk access instead of relying on `noVNC`
- `npm run firefox:vm:reset-profile` to wipe the saved VM Firefox profile when a clean login/session is needed
- Checks are quiet on success by default; set `CBE_VERBOSE=1` to stream full tool output when debugging.

## UI preview

<!-- popup-screenshot:start -->
![Extension popup in dark theme](docs/images/popup-dark.jpeg)
<!-- popup-screenshot:end -->

## Renovate automation

- Dependency updates are managed by Renovate using `.github/renovate.json`.
- Renovate opens PRs for npm and GitHub Actions updates.
- Renovate also updates pinned `web-ext` CLI versions used in workflows and scripts.
- Auto-merge is enabled only for selected non-major updates.
- Covered by auto-merge: GitHub Actions, npm `devDependencies`, and pinned `web-ext` CLI updates.
- Auto-merge runs only after required CI checks pass.
- Major updates and npm runtime `dependencies` remain manual-review PRs.

## CI maintenance note

- Versions of core GitHub Actions are updated centrally in `.github/workflows/*.yml`.
- This keeps pipelines aligned on the latest stable majors:
  `actions/checkout`, `actions/setup-node`, `actions/cache`.
