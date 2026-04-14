# Mock GPT Harness

This repo can replay captured GPT DOM fixtures locally and boot the real extension content script
against them. The goal is not a perfect clone of the product stack. The goal is a stable harness
that keeps extension behavior testable when live GPT blocks automation or changes too quickly.

## Start

- `npm run mock-gpt`
- Open `http://127.0.0.1:4173/c/mock-chat`

The harness serves:

- `dist/content.js` from the current build
- `tests/fixtures/*.html` through a small local catalog
- GPT-like routes such as `/c/<fixture-name>` or `/codex`

The page injects a storage shim before loading `dist/content.js`, so the extension logic runs with
the same settings model it uses inside Firefox.

## What It Is Good For

- replaying current GPT DOM structure without talking to the live site
- checking selector drift and layout-sensitive features against captured markup
- toggling extension settings quickly while staying on one local page
- reproducing bugs found in the isolated Firefox VM and turning them into durable tests

## Refresh Fixtures From Real GPT

Use the isolated VM flow first:

- `npm run firefox:vm`
- log into GPT in the VM browser
- navigate to the surface you need to mirror

Then open DevTools in that VM browser and run the snippet from
[`mock-gpt/fixture-dump-snippet.js`](/home/qqrm/repos/github/wt/chatgpt-better-experience-gpt-mirror-harness/mock-gpt/fixture-dump-snippet.js:1).

Save the generated HTML file into `tests/fixtures/`. The server picks it up automatically on the
next page load.

The snippet captures:

- `head` stylesheet links and inline style blocks
- chat history nav
- main conversation area
- composer form when present
- fixture origin and dark/light theme marker

That keeps the harness aligned with the real DOM contracts this extension depends on while staying
offline and deterministic.

## Limits

- It does not reproduce real OpenAI network behavior.
- It does not replace live manual checks in the isolated Firefox VM.
- It is only as current as the latest captured fixture.

Use the harness to stabilize fixes, then confirm the same behavior manually on real GPT in the VM.
