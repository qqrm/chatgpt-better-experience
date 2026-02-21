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

## Dependabot automation

- Runs every 2 hours (and on manual dispatch) via `.github/workflows/dependabot-autoupdate-automerge.yml`.
- Labels failing Dependabot PRs with `ci-failed` (sticky) and `needs-human`; those PRs are excluded from future automatic rebases and auto-merge enablement.
- Respects `do-not-automerge` as a manual override.
- To unblock a PR after CI is fixed, remove the `ci-failed` label manually and rerun the workflow.
