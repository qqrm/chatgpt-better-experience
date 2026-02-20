# Performance validation plan

## Goal

Verify there is no continuous idle CPU burn from content-script DOM watchers.

## Browser tools

- **Firefox:** open `about:performance` and watch the ChatGPT tab/process.
- **Chrome/Chromium:** open Task Manager (`Shift+Esc`) and watch CPU for the ChatGPT tab + extension process.
- Optional: DevTools Performance panel with a 30–60s idle recording.

## Manual scenarios

1. Open ChatGPT home and wait 20–30s.
2. Open an existing conversation with long history.
3. Scroll up/down several screens, then stop and idle 20s.
4. Switch between 3–5 different chats from the sidebar.
5. Open/close sidebar panels and hover chat rows (one-click delete controls).
6. Delete or archive one conversation via one-click delete.
7. Toggle feature settings from extension popup:
   - wide chat
   - trim chat DOM
   - hide share button
   - auto temp chat
8. Return to idle state without typing or scrolling.

## Expected results

- CPU should briefly spike during route changes/mutations, then return near idle.
- No periodic spikes every ~1s from the extension when page is idle.
- No long-running observer churn in Performance traces while idle.

## Internal debug counters (when debug logger enabled)

- `wideChat`: observer callbacks / apply runs / processed nodes.
- `trimChatDom`: observer callbacks / apply runs / processed nodes.
- `oneClickDelete`: observer callbacks / hook/apply runs / processed nodes.
- `autoTempChat`: observer callbacks / apply runs / processed nodes.

Counters should increase during real UI changes and stop growing quickly when idle.

## Bus stats

When debug logger is enabled in the content script (`DEBUG = true`), the shared DOM bus emits counters through feature logs.

- `mainObserverCalls` / `navObserverCalls`: MutationObserver callback invocations for each channel.
- `mainNodes` / `navNodes`: total nodes touched by mutation records.
- `emits`: number of coalesced bus delta events delivered.
- `rebinds`: root rebind attempts from route changes/root replacement.

Expected behavior: after route settles and the page is idle, `emits` (and per-feature counters) should stop increasing.
