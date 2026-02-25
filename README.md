# ChatGPT Better Experience

Firefox extension that adds quality-of-life features to ChatGPT/Codex.

Install: https://addons.mozilla.org/en-US/firefox/addon/chatgpt-better-expierience/

Docs: see [docs/README.md](docs/README.md)

Dev:

- `npm ci`
- `npm run verify`
- `npm run build`

## UI preview

<!-- popup-screenshot:start -->

![Extension popup in dark theme](docs/images/popup-dark.jpeg)

<!-- popup-screenshot:end -->

## Renovate automation

- Dependency updates are managed by Renovate using `.github/renovate.json`.
- Renovate opens PRs for npm and GitHub Actions updates, plus pinned `web-ext` CLI versions referenced in workflows/scripts.
- Auto-merge is enabled only for selected non-major updates (GitHub Actions, npm `devDependencies`, and pinned `web-ext` CLI updates), and only after required CI checks pass.
- Major updates and npm runtime `dependencies` remain manual-review PRs.

## CI maintenance note

- Versions of core GitHub Actions (`actions/checkout`, `actions/setup-node`, `actions/cache`) are updated centrally across `.github/workflows/*.yml` to keep pipelines aligned on the latest stable majors.
