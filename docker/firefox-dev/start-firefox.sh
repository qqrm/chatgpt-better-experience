#!/usr/bin/env bash
set -euo pipefail

export DISPLAY=:99

WIDTH="${DISPLAY_WIDTH:-1440}"
HEIGHT="${DISPLAY_HEIGHT:-900}"
DPI="${DISPLAY_DPI:-96}"
RUNTIME_DIR="${RUNTIME_DIR:-/workspace/.runtime/firefox-container}"
PROFILE_DIR="${PROFILE_DIR:-$RUNTIME_DIR/profile}"
LOG_DIR="${LOG_DIR:-$RUNTIME_DIR/logs}"
START_URL="${START_URL:-https://chatgpt.com/}"
FIREFOX_BIN="${FIREFOX_BIN:-$(command -v firefox-esr || command -v firefox)}"

mkdir -p "$PROFILE_DIR" "$LOG_DIR"

cleanup() {
  local exit_code=$?
  for pid_var in WEB_EXT_PID WEBSOCKIFY_PID X11VNC_PID FLUXBOX_PID XVFB_PID; do
    pid="${!pid_var:-}"
    if [[ -n "${pid}" ]]; then
      kill "${pid}" 2>/dev/null || true
    fi
  done
  wait || true
  exit "$exit_code"
}

trap cleanup EXIT INT TERM

Xvfb "$DISPLAY" -screen 0 "${WIDTH}x${HEIGHT}x24" -dpi "$DPI" -nolisten tcp >"$LOG_DIR/xvfb.log" 2>&1 &
XVFB_PID=$!
sleep 1

fluxbox >"$LOG_DIR/fluxbox.log" 2>&1 &
FLUXBOX_PID=$!

x11vnc -display "$DISPLAY" -forever -shared -nopw -rfbport 5900 >"$LOG_DIR/x11vnc.log" 2>&1 &
X11VNC_PID=$!

websockify --web=/usr/share/novnc/ 6080 localhost:5900 >"$LOG_DIR/novnc.log" 2>&1 &
WEBSOCKIFY_PID=$!

cd /workspace

HUSKY=0 npm ci --no-audit --no-fund

npm run build

npx --yes web-ext@9.3.0 run \
  --source-dir=dist \
  --artifacts-dir=web-ext-artifacts \
  --target=firefox-desktop \
  --firefox="$FIREFOX_BIN" \
  --firefox-profile="$PROFILE_DIR" \
  --profile-create-if-missing \
  --keep-profile-changes \
  --no-reload \
  --no-input \
  --start-url="$START_URL" \
  --pref=browser.shell.checkDefaultBrowser=false \
  --pref=browser.startup.homepage_override.mstone=ignore \
  --pref=browser.startup.firstrunSkipsHomepage=true \
  --pref=browser.aboutConfig.showWarning=false \
  --pref=datareporting.healthreport.uploadEnabled=false \
  --pref=app.normandy.enabled=false \
  --pref=toolkit.telemetry.enabled=false &
WEB_EXT_PID=$!

wait "$WEB_EXT_PID"
