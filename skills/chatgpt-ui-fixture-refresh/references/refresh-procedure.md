# ChatGPT UI fixture refresh procedure

Use this procedure after the skill has identified a concrete surface or selector to audit.

## 1. Capture only structural evidence

1. Open the required ChatGPT surface in a browser session that the user has explicitly allowed.
   Keep the interaction read-only: do not submit text, change settings, or retrieve
   credentials, cookies, or network payloads.
2. In DevTools Console, run
   `mock-gpt/fixture-structure-dump-snippet.js` from this repository.
3. Save the downloaded structure-only HTML. Inspect it before copying it into
   `tests/fixtures/`. It must have placeholder text only and must not contain:
   external URLs; `href` or `src`; `script`, `style`, or `link` elements; inline `style`;
   `aria-label`; message IDs; or conversation/account-specific data.
4. Name the file with the capture date and add the covered surface and selector counts to
   `docs/live-ui-audit.md`. State which controls were not present so a later audit can cover
   them separately.

## 2. Change the extension deliberately

Read the feature registration and the affected content module before changing selectors.
Prefer resilient selector fallbacks that are supported by the new fixture. Do not delete an
existing feature merely because a selector was absent from one route. Add or update a focused
test when the behavior can be expressed in the local harness.

## 3. Replay and validate

From the repository root:

```bash
npm run build
npm run mock-gpt
```

Open the relevant local route (for example `/c/<fixture-name>`) and confirm the fixture is loaded
and the affected setting works. The local fixture must not fetch its source origin.

Before a PR, run:

```bash
npm run verify:ci
```

If packaging, manifest, build scripts, workflows, or extension assets changed, this command also
covers the required Firefox/AMO packaging checks. Inspect `dist/manifest.json` when such paths
are touched.
