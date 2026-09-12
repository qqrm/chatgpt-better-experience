---
name: chatgpt-ui-fixture-refresh
description: Refresh the local Mock GPT fixture and extension selector audit after ChatGPT UI changes. Use when ChatGPT markup or controls have drifted; do not use for live-service behavior, API, or account automation.
---

# ChatGPT UI Fixture Refresh

Keep this extension compatible with the rendered ChatGPT UI while making repeatable
checks against the repository's local Mock GPT harness.

## Start with the existing contracts

- Read `docs/live-ui-audit.md`, `docs/mock-gpt.md`,
  `mock-gpt/fixture-structure-dump-snippet.js`, and the affected content feature before
  deciding which selector or feature changed.
- Treat a signed-in ChatGPT page as a source of structural evidence, not as a test runner.
  Do not send messages, alter account settings, inspect credentials, or export conversation
  content. Only use browser access that the user has authorized.
- A missing element on one route is evidence that the route did not cover that control, not
  evidence that the feature is obsolete. Open the relevant surface deliberately when coverage
  requires it.

## Refresh the evidence

Use the approved structural exporter in the browser's DevTools Console. It retains only
selector-relevant DOM structure and replaces content with placeholders. Before adding its output
to `tests/fixtures/`, confirm that it contains no external URL, text from the conversation,
`aria-label`, message ID, inline style, or executable element.

Record selector counts and the route/surface coverage in `docs/live-ui-audit.md`. Update a
feature's selectors or tests only when the new structural evidence and the implementation agree.
Keep historical fixtures if they still cover a distinct compatibility case.

## Verify locally

Build the extension and replay the fixture through `npm run mock-gpt`; use the harness to check
the affected behavior without recontacting ChatGPT. Run the repository's CI-equivalent command
before submitting the change. For the detailed capture checklist and validation commands, read
[the refresh procedure](references/refresh-procedure.md).

## Boundaries

This skill preserves structural compatibility. Do not use it to clone ChatGPT's full frontend,
capture authenticated data, reverse engineer network traffic, or infer undocumented product/API
contracts. A proposed "Run in Codex" action is a separate capability and needs a documented
handoff/deep-link contract before implementation.
