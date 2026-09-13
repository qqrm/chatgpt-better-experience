# Live ChatGPT UI audit manifest

## Scope and privacy boundary

This audit uses a signed-in, already-open ChatGPT page in Zen on 2026-09-12. It is read-only:
no message is sent, no account setting is changed, and the audit initiates no network request.
Capture artifacts exclude conversation text, account identifiers, cookies, request bodies, and
response bodies.

The purpose is to keep the extension aligned with the rendered ChatGPT UI without using live
ChatGPT for repeatable tests.

## Source manifest

| Source                                                    | Status                  | Included data                                                                                  | Explicit exclusion                                             |
| --------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Current conversation route in Zen                         | discovered              | layout, role and attribute structure, element counts, computed-style tokens, selector presence | conversation text, chat id, account details, files, media URLs |
| Sidebar in the current route                              | discovered              | navigation structure and expansion controls                                                    | chat and project titles                                        |
| Composer in the current route                             | discovered              | form, editor, and send-control structure                                                       | draft text, voice input, attachments                           |
| Markdown and code blocks in the current route             | discovered              | code-block wrapper and action-control structure                                                | code contents                                                  |
| DevTools Console                                          | discovered              | browser-reported DOM structure and extension diagnostics                                       | network request/response payloads and telemetry                |
| `tests/fixtures/chatgpt-fixture-2026-02-04-17-23-37.html` | included for comparison | historical DOM contract                                                                        | evidence of the current UI                                     |

## Loaded feature coverage

Every content feature registered by `src/application/contentScript.ts` is in scope. A feature is
not current until its selectors and user-visible behavior have a privacy-safe fixture and test.

| Feature                   | Required current-page probe                   |
| ------------------------- | --------------------------------------------- |
| Dictation auto-send       | composer, dictation control, send control     |
| Edit last message         | latest user-message menu and edit form        |
| Auto-expand chats         | sidebar expansion controls                    |
| Auto-expand projects      | project group and nested chat controls        |
| Auto temporary chat       | temporary-chat control and state              |
| One-click delete          | chat-row action menu                          |
| Message timestamps        | message metadata and conversation identity    |
| Preserve reading position | composer send transition and scroll container |
| Hide share button         | share action                                  |
| Download patch menu item  | Markdown/code-block action menu               |
| Wide chat                 | main layout container                         |
| Ctrl+Enter send           | composer/editor and send control              |
| Macro recorder            | page lifecycle and explicit recorder UI       |

## Current-page structural fingerprint

The following counts were obtained from the active ChatGPT conversation using a Console expression
that calls only `document.querySelectorAll(...).length`. It does not read text, attributes,
cookies, storage, request bodies, or response bodies.

| Selector contract                         | Count | Audit consequence                                              |
| ----------------------------------------- | ----: | -------------------------------------------------------------- |
| `main`                                    |     1 | main-content anchor is present                                 |
| `nav[aria-label='Chat history']`          |     1 | chat sidebar anchor is present                                 |
| `[data-testid='composer']`                |     0 | do not require this wrapper                                    |
| `[data-testid='composer-footer-actions']` |     0 | do not require the legacy footer anchor                        |
| `[data-testid='prompt-textarea']`         |     0 | do not require this test id                                    |
| `#prompt-textarea`                        |     1 | current composer fallback is present                           |
| `[contenteditable='true']`                |     1 | editor fallback is present                                     |
| `[data-message-author-role]`              |     2 | message-role contract is present                               |
| `[data-testid^='conversation-turn-']`     |     2 | conversation-turn contract is present                          |
| `[data-scroll-root]`                      |     1 | scroll-root contract is present                                |
| `[class*='sidebar-expando-section']`      |     8 | sidebar expando contract is present                            |
| `button[aria-expanded]`                   |    36 | expansion controls exist; scope them before action             |
| `a[href*='/project/']`                    |     0 | projects cannot be assessed from this route                    |
| `a[href*='/c/']`                          |    21 | conversation-link contract is present                          |
| `[role='menu']`                           |     0 | action menus require an explicit open-menu probe               |
| `input[type='checkbox']`                  |     0 | temporary-chat control requires an explicit open-control probe |
| `[data-testid*='share' i]`                |     2 | share test-id contract is present                              |

This captures two actionable compatibility facts: the composer no longer provides the older
`data-testid` wrappers, and the current fallback pair (`#prompt-textarea` plus
`[contenteditable='true']`) is available. No feature is removed on this evidence alone.

## Evidence rules

- A browser snapshot records selector match counts, tag names, non-content attributes, and an
  allowlist of computed styles only.
- An exported fixture replaces text nodes with stable placeholders before it is written to disk.
- `mock-gpt/fixture-structure-dump-snippet.js` is the approved browser-side exporter. It keeps
  only structural attributes and removes every external URL, stylesheet, inline style, and media
  reference so replaying the fixture cannot contact ChatGPT or another origin.
- Network inspection is diagnostic only: no request body, response body, cookie, token, or
  telemetry identifier is exported or committed.
- A feature can be marked obsolete only after its current-page probe and existing test are both
  reviewed. A missing selector in one conversation is not enough to remove it.

## Deferred product decision

"Run in Codex" for a Markdown/code block is a separate capability. Before implementation, audit
the available Codex deep-link or handoff contract and decide whether it can carry code without
relying on undocumented ChatGPT internals.
