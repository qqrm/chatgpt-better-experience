# Feature audit matrix

This is the authoritative working matrix for the extension audit. A green unit test is not a
claim that a feature has been verified against the current ChatGPT UI. September evidence below
is historical; see the dated refresh for the latest results. Each row requires the
listed evidence before it can be marked live-verified.

## Source manifest

| Source                                                    | Status             | Role in the audit                                                                            |
| --------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------- |
| `src/application/contentScript.ts`                        | included           | Registers 13 runtime handles; F2 rename is a separate behavior inside the edit handle.       |
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

| Feature                   | Unit evidence                                 | Offline integration evidence                 | Live structural evidence                    | Required before live behavioral verification                | Current status                               |
| ------------------------- | --------------------------------------------- | -------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------- |
| Dictation auto-send       | `tests/dictationAutoSend*`                    | Ctrl+Space activates synthetic dictation     | composer fallback present                   | a user-safe real-page lifecycle and send-control surface    | unit + offline integration                   |
| Edit last message         | `tests/editLastMessage.test.ts`               | ArrowUp opens synthetic last-message editor  | user turn and composer present              | open latest-message menu and edit form                      | unit + offline integration                   |
| Auto-expand chats         | `tests/autoExpandChats.test.ts`               | expands semantic synthetic `Chats` section   | sidebar expando sections present            | a semantic `Chats` header; structural fixture redacts it    | unit + offline integration + live structural |
| Auto-expand projects      | `tests/autoExpandProjects*`                   | expands synthetic Project section            | absent on inspected route                   | a Project route with preserved project hrefs                | unit + offline integration                   |
| Auto temporary chat       | `tests/autoTempChat.test.ts`                  | checks synthetic Temporary Chat control      | absent on inspected route                   | Temporary Chat control and checkbox                         | unit + offline integration                   |
| One-click delete          | `tests/oneClickDelete*`                       | enabled/disabled marker replay               | conversation links present                  | open row menu; do not confirm a real deletion               | unit + offline integration + live structural |
| Message timestamps        | `tests/messageTimestamps*`                    | synthetic send renders a user timestamp      | message roles and turns present             | timestamp-bearing rendered messages without reading content | unit + offline integration + live structural |
| Preserve reading position | `tests/preserveReadingPositionOnSend.test.ts` | synthetic post-send scroll restores baseline | scroll root and composer present            | a browser-level measurable scroll transition                | unit + offline integration + live structural |
| Hide share button         | `tests/hideShareButton.test.ts`               | hides semantic Share control and cleans up   | share test-id present                       | a semantic share control; `aria-label` was redacted         | unit + offline integration + live structural |
| Download patch menu item  | `tests/downloadPatchMenuItem.test.ts`         | Shift-click produces both runtime requests   | code/menu surface absent on inspected route | a current Codex task menu and actual download completion    | unit + offline integration                   |
| Wide chat                 | `tests/wideChat*`                             | enable/cleanup replay                        | main and turns present                      | visual width/overlap checkpoint                             | unit + offline integration + live structural |
| Ctrl+Enter send           | `tests/ctrlEnterSend.test.ts`                 | synthetic form receives submit               | composer fallback present                   | local form-submit fixture with no network target            | unit + offline integration + live structural |
| Macro recorder            | `tests/macroRecorder*`                        | Ctrl+Shift+F8 start/stop saves synthetic run | page lifecycle only                         | a user-safe real-page lifecycle and export inspection       | unit + offline integration                   |

## Known audit constraints

- The privacy-safe structural fixture must not be repurposed as a semantic fixture: it strips the
  labels, text, URLs, and message identifiers that several features deliberately use.
- An offline integration fixture must be synthetic and contain no conversation or account data.
- The September audit could not start the VM or container stand. The October refresh below
  supersedes that environment result; the old Zen capture remains historical evidence only.
- Auto-expand Chats ignores untrusted synthetic events in its user-cooldown guard. This prevents
  an adjacent extension feature's automated sidebar click from suppressing the Chats expansion.
- Preserve reading position previously treated its `0` sentinel as a fresh manual-scroll event
  during the first 450 ms after page startup. The regression is fixed and covered by the synthetic
  scroll model; a current ChatGPT behavioral run still requires the isolated browser stand.
- Patch-download integration confirms the content-script-to-runtime message contract with a local
  runtime double. It intentionally does not claim a browser file download or clipboard access.
- Storage subscriptions now return an unsubscribe function. Content-script unload disposes every
  registered feature and its storage subscription; Auto-expand Projects also releases its local
  storage subscription during feature disposal. This closes a lifecycle gap found during the audit.
- The Mock GPT storage shim implements `storage.local.remove`, matching the macro recorder's export
  cleanup contract. The local start/stop scenario now reaches `Macro recording saved`.

## Refresh: 2026-10-25

Base: `35fa4d5`, extension manifest `1.0.268`. No manual version bump.
This refresh does **not** certify all functionality against signed-in ChatGPT.

### Source coverage manifest

| Source                                                                          | Inclusion and evidence                                                                                                              | Remaining coverage                                                                                                                |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/application/contentScript.ts`, all `src/features/*.ts`                     | All 13 registered feature handles mapped to the matrix; F2 added below                                                              | Current signed-in behavior of every feature remains unverified                                                                    |
| `src/domain/`, `src/application/`, `src/infra/`, `src/lib/`, `src/entrypoints/` | Existing unit, integration and lifecycle suite executed                                                                             | Tests are bounded regression evidence, not exhaustive proof                                                                       |
| `src/popup/`                                                                    | Popup/controller/use-case and settings tests executed                                                                               | Real Firefox popup interaction not exercised                                                                                      |
| `src/background.ts`                                                             | Download implementation inspected; build and AMO lint passed                                                                        | Browser download completion and clipboard behavior not exercised; no dedicated background unit suite                              |
| All `tests/*.test.ts`                                                           | 39 files, 175 tests passed, including three new F2 tests                                                                            | JSDOM does not implement native form submission; browser replay covers the synthetic submit boundary                              |
| `tests/fixtures/`                                                               | February semantic HTML, September structural HTML, synthetic interaction HTML, macro export JSON discovered; fixture tests executed | Historical fixtures do not establish October selector compatibility                                                               |
| `mock-gpt/`, `scripts/mock-gpt-server.mjs`                                      | Built content script replayed in the in-app browser on synthetic HTML                                                               | Runtime/storage are doubles; no real download, microphone or API contract is proved                                               |
| `config/`, `icons/`, `icons-src/`, build/check scripts                          | Build, typecheck, lint, format, AMO lint/package; generated manifest inspected                                                      | No AMO publication/signing performed as part of local validation                                                                  |
| `docker/`, Compose and Firefox scripts                                          | Container built; Firefox installed the temporary extension; screenshot captured                                                     | Windows PowerShell screenshot wrapper changed; underlying Compose command exercised, wrapper not executed in WSL                  |
| Multipass VM                                                                    | Executable absent from PATH and documented Windows fallback                                                                         | VM runtime unavailable; Docker fallback used                                                                                      |
| Live `https://chatgpt.com/` in isolated Firefox                                 | Logged-out landing page loaded, verified by screenshot                                                                              | Login required for chat history, projects, conversation actions and Codex task surfaces                                           |
| `docs/`, README/specifications                                                  | Existing audit and stand instructions reviewed and refreshed                                                                        | September live DOM fingerprint retained as dated historical evidence                                                              |
| `.github/` workflows, actions and policy scripts                                | 33 Python policy tests, actionlint and zizmor passed                                                                                | Hosted CodeQL and required PR gates must be confirmed by CI                                                                       |
| `package.json`, `package-lock.json`                                             | Installed reproducibly; compatible fast-uri and undici updates applied                                                              | Three high audit entries remain on the node-forge → adbkit → web-ext development chain; registry latest node-forge is still 1.4.0 |

### Behavior replayed in this refresh

| Behavior                                         | Current evidence                                                               | Limit                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Dictation lifecycle / auto-send / start shortcut | Existing machine, command executor and feature tests passed                    | Actual audio and live send not exercised                                                       |
| ArrowUp edit                                     | Synthetic browser replay focused the last message editor; unit tests passed    | Live edit UI requires login                                                                    |
| F2 rename                                        | Three new tests cover exact conversation ID, disabled setting and key repeat   | Fixed prefix-match bug; live rename not exercised                                              |
| Auto-expand chats and projects                   | Both synthetic sections visibly expanded                                       | Account sidebar and project-item nesting require login; nesting covered only by existing tests |
| Auto temporary chat                              | Synthetic checkbox became checked after enabling setting and reloading harness | Live temporary-chat control not exercised                                                      |
| One-click chat actions                           | Synthetic pin/archive/delete controls rendered; unit/fixture tests passed      | Actual deletion/archive/pin not performed                                                      |
| Message timestamps                               | Synthetic submitted message acquired a visible timestamp                       | Live API metadata not exercised                                                                |
| Preserve reading position                        | Existing scroll regression tests passed                                        | No new browser-level scroll measurement                                                        |
| Hide Share                                       | Synthetic Share control disappeared after applying setting                     | Live Share surface requires conversation                                                       |
| Patch download and clipboard option              | Existing feature tests passed; background inspected                            | No real browser download or clipboard mutation                                                 |
| Wide chat                                        | Existing layout/relevance tests passed                                         | No fresh visual width/overlap measurement                                                      |
| Ctrl+Enter send                                  | Synthetic form visibly appended a submitted message                            | No real ChatGPT message sent                                                                   |
| Macro recorder                                   | Synthetic start/stop displayed “Macro recording saved”; contract tests passed  | Firefox export and real-page recording not exercised                                           |
| Popup/settings/debug/storage/lifecycle           | Existing suites passed                                                         | Live settings propagation not checked in Firefox                                               |

Local checks used Node 24.22.1 through `npm exec --yes --package=node@24.22.1 -- ...`.
The host default 24.14.0 is below jsdom's required 24.15.0 minimum on the Node 24 line.
`npm audit --omit=dev` reported zero vulnerabilities; full `npm audit` still fails on the
development dependency chain above. Downgrading web-ext to npm's suggested 5.1.0 was not applied.
