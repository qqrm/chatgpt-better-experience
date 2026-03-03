# Behavior notes

## Auto-expand features

Auto-expand features (chat list, projects list, per-project items) trigger only:

- immediately when you enable them in the extension popup UI;
- on page load when the option is already enabled.

They are not intended to keep the UI permanently expanded. The user can collapse manually and the extension should not fight that.

They must not retrigger on tab focus/visibility changes, internal ChatGPT route changes, or sidebar re-renders.

## Trim chat DOM

When enabled, older chat history is hidden in the DOM rather than removed. In the chat, a small banner indicates that older messages are hidden and offers one-click restore options:

- restore 25%
- restore 50%
- restore all

This is intentionally non-destructive and does not require a page reload.
