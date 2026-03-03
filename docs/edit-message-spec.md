# Message edit UX

This extension provides two related behaviors:

1. Enter "edit last user message" mode quickly (ArrowUp).
2. Make Ctrl/Cmd+Enter apply the edit when an edit panel is open.

## ArrowUp edit last message

When `Edit last message on ArrowUp` is enabled:

- If the user presses ArrowUp while the main composer is empty (or when triggered from the conversation area),
  the extension finds the most recent user message and triggers ChatGPT's built-in **Edit message** action.
- The message is scrolled into view, centered in the viewport.
- The edit input is focused and the caret is placed at the end of the message.
- For long messages, the editor is scrolled so the caret area (typically the end) stays visible.

Expected UX outcome: after ArrowUp, you can immediately continue typing at the end of the last message and see
what you are editing without manual scrolling.

## Ctrl/Cmd+Enter behavior during edit

When `Ctrl/Cmd+Enter sends` is enabled:

- If a message edit panel is open, Ctrl/Cmd+Enter **clicks the edit panel's positive action**
  (commonly a button labelled “Send”, “Save”, “Apply”, “Update”, “Done”, etc.) instead of sending a new message.
- Only if no edit panel is detected does Ctrl/Cmd+Enter fall back to the normal send behavior.

This is required because ChatGPT can prevent default on Ctrl/Cmd+Enter before the extension's handler runs;
the extension must still prioritize the edit apply action.

## Debug traces

The popup includes `Debug traces`:

- Enable the switch to allow debug logs.
- Use the dropdown to select which subsystem is traced.

For message edit tracing, select `Message edit`. Logs are written to the console and prefixed with:

- `[TM][edit]`
