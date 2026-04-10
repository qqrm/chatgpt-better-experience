# Container Firefox Debug

This repo can run the extension inside an isolated Docker container instead of starting Firefox on
the host system.

## Goals

- No Firefox windows on the host desktop.
- No interference with the user's main browser profile or mouse workflow.
- A reproducible Firefox runtime for extension debugging that stays inside Docker.

## Commands

- `npm run firefox:dev`
  Builds and starts the Firefox dev container.
- `npm run firefox:dev:status`
  Shows container status.
- `npm run firefox:dev:logs`
  Shows recent container logs.
- `npm run firefox:dev:screenshot`
  Captures the current Firefox window from the containerized X server into
  `.runtime/firefox-container/firefox-screen.png`.
- `npm run firefox:dev:stop`
  Stops and removes the container.

## Access

- noVNC UI: `http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=scale`

The browser is rendered inside the container and exposed through noVNC. If nobody opens the noVNC
page, nothing steals focus on the host desktop.

The screenshot command is useful when the agent needs a visual checkpoint without opening a host
browser window.

## Container behavior

- The container installs Firefox ESR plus a lightweight X11/VNC stack.
- The extension is launched with `web-ext run` from the built `dist/` directory.
- The repo is mounted into `/workspace`.
- Container-only runtime data is stored under `.runtime/firefox-container/` in the repo and ignored
  by git.

## Practical limitation

Live ChatGPT checks are still discovery-oriented and can be fragile. The durable regression signal
for this project remains repo tests and fixtures. Use the containerized browser to inspect current
behavior, then lock the fix down with tests in the repo.
