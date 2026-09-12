# Feature audit matrix

This is the authoritative working matrix for the extension audit. A green unit test is not a
claim that a feature has been verified against the current ChatGPT UI. Each row requires the
listed evidence before it can be marked live-verified.

## Source manifest

| Source                                                    | Status             | Role in the audit                                                                            |
| --------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------- |
| `src/application/contentScript.ts`                        | included           | Registers the 14 runtime features; this is the complete feature inventory.                   |
| `src/features/*.ts`                                       | included           | Defines implementation contracts and cleanup behavior.                                       |
| `tests/*.test.ts`                                         | included           | Unit and fixture-level regression evidence.                                                  |
| `tests/fixtures/chatgpt-fixture-2026-02-04-17-23-37.html` | included           | Historical semantic fixture; not evidence of the current UI.                                 |
| `tests/fixtures/chatgpt-structure-2026-09-12.html`        | included           | Current privacy-safe structural evidence; text, `href`, and labels are intentionally absent. |
| `mock-gpt/`                                               | included           | Offline content-script replay harness.                                                       |
| `docs/live-ui-audit.md`                                   | included           | Current-page selector fingerprint and live-surface coverage gaps.                            |
| Live signed-in ChatGPT UI                                 | partially included | Read-only structural inspection only; no messages, settings changes, or data export.         |

## Evidence scale

- **Unit**: a focused test proves an isolated behavior.
- **Offline integration**: the built content script changes a local fixture through Mock GPT.
- **Live structural**: the current DOM contract has been observed without performing a user action.
- **Live behavioral**: the enabled feature has completed its visible action on the current UI.

## Feature status

| Feature                   | Unit evidence                                 | Offline integration evidence                | Live structural evidence                    | Required before live behavioral verification                | Current status                               |
| ------------------------- | --------------------------------------------- | ------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------- |
| Dictation auto-send       | `tests/dictationAutoSend*`                    | not yet                                     | composer fallback present                   | a non-network dictation lifecycle and send-control surface  | unit only                                    |
| Edit last message         | `tests/editLastMessage.test.ts`               | ArrowUp opens synthetic last-message editor | user turn and composer present              | open latest-message menu and edit form                      | unit + offline integration                   |
| Auto-expand chats         | `tests/autoExpandChats.test.ts`               | expands semantic synthetic `Chats` section  | sidebar expando sections present            | a semantic `Chats` header; structural fixture redacts it    | unit + offline integration + live structural |
| Auto-expand projects      | `tests/autoExpandProjects*`                   | expands synthetic Project section           | absent on inspected route                   | a Project route with preserved project hrefs                | unit + offline integration                   |
| Auto temporary chat       | `tests/autoTempChat.test.ts`                  | checks synthetic Temporary Chat control     | absent on inspected route                   | Temporary Chat control and checkbox                         | unit + offline integration                   |
| One-click delete          | `tests/oneClickDelete*`                       | enabled/disabled marker replay              | conversation links present                  | open row menu; do not confirm a real deletion               | unit + offline integration + live structural |
| Trim chat DOM             | `tests/trimChatDom.test.ts`                   | trims two turns, then restores all          | conversation turns present                  | more turns than keep threshold and restore controls         | unit + offline integration + live structural |
| Message timestamps        | `tests/messageTimestamps*`                    | style loads; message data unavailable       | message roles and turns present             | timestamp-bearing rendered messages without reading content | unit + partial structural                    |
| Preserve reading position | `tests/preserveReadingPositionOnSend.test.ts` | not yet                                     | scroll root and composer present            | a local send transition with measurable scroll position     | unit + live structural                       |
| Hide share button         | `tests/hideShareButton.test.ts`               | hides semantic Share control and cleans up  | share test-id present                       | a semantic share control; `aria-label` was redacted         | unit + offline integration + live structural |
| Download patch menu item  | `tests/downloadPatchMenuItem.test.ts`         | not yet                                     | code/menu surface absent on inspected route | a synthetic patch and open action menu; no clipboard export | unit only                                    |
| Wide chat                 | `tests/wideChat*`                             | enable/cleanup replay                       | main and turns present                      | visual width/overlap checkpoint                             | unit + offline integration + live structural |
| Ctrl+Enter send           | `tests/ctrlEnterSend.test.ts`                 | synthetic form receives submit              | composer fallback present                   | local form-submit fixture with no network target            | unit + offline integration + live structural |
| Macro recorder            | `tests/macroRecorder*`                        | not yet                                     | page lifecycle only                         | synthetic user events and local export assertion            | unit only                                    |

## Known audit constraints

- The privacy-safe structural fixture must not be repurposed as a semantic fixture: it strips the
  labels, text, URLs, and message identifiers that several features deliberately use.
- An offline integration fixture must be synthetic and contain no conversation or account data.
- The VM stand currently cannot start because Multipass is unavailable; the container stand cannot
  start until Docker Desktop's daemon is running. The host Zen page remains read-only evidence
  until a reproducible isolated behavioral path is available.
- Auto-expand Chats ignores untrusted synthetic events in its user-cooldown guard. This prevents
  an adjacent extension feature's automated sidebar click from suppressing the Chats expansion.
