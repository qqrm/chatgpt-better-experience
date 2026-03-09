# Release checklist

1. Ensure the working tree is clean and checks pass:

- `npm run verify`

2. Update the version in `config/extension/manifest.base.json` (and anywhere else required by the store).

3. Build the extension bundle:

- `npm run build`

4. Package the build output per store requirements and submit.
