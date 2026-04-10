# Multipass Firefox Debug

This repo can run an isolated Ubuntu VM on Hyper-V through Multipass and launch Firefox inside that
guest instead of touching the host browser session.

## Goals

- Keep Firefox and ChatGPT off the host desktop.
- Give the agent a real browser that can be inspected through screenshots or noVNC.
- Keep extension debugging reproducible from the repo with a single command path.

## Commands

- `npm run firefox:vm`
  Creates or starts the VM, mounts the repo into the guest, installs Firefox runtime dependencies,
  and launches ChatGPT in guest Firefox using the persistent guest profile.
- `npm run firefox:vm:status`
  Shows VM status, SSH target, noVNC URL, and the guest mount path.
- `npm run firefox:vm:logs`
  Prints recent guest logs for Firefox, x11vnc, noVNC, and Xvfb.
- `npm run firefox:vm:reset-profile`
  Deletes the guest Firefox profile so the next launch starts from a clean state.
- `npm run firefox:vm:screenshot`
  Captures the guest display into `.runtime/multipass/firefox-screen.png`.
- `npm run firefox:vm:stop`
  Stops the VM.

## Access

- SSH: the status command prints the exact `ssh -i ... ubuntu@<ip>` command.
- noVNC: the status command prints `http://<guest-ip>:6082/vnc.html?autoconnect=true&resize=scale`

The repo is mounted into the guest at `/home/ubuntu/cbe`.

## Notes

- This workflow uses a generic Ubuntu 24.04 cloud image plus cloud-init for SSH access.
- The guest browser uses the official Mozilla Linux tarball instead of the Ubuntu snap package to
  avoid snap-specific profile locking in automated runs.
- The Firefox profile lives inside the VM at `/home/ubuntu/.cbe-firefox-profile`, so login state
  and cookies survive normal `stop` / `start` cycles.
- Use `npm run firefox:vm:reset-profile` only when a task needs a clean browser state or the saved
  profile becomes unusable.
- Live ChatGPT checks still need an authenticated browser session inside the guest if the broken
  functionality only reproduces after login.
