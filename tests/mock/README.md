# ChatGPT Mock SPA

This folder contains a minimal static mock of the ChatGPT UI. It is designed specifically for extension development and automated tests.

## Files

- chat/index.html
  - main mock page
  - includes chat list, options menu, delete modal, composer, dictation controls, and edit mode

- codex/index.html
  - redirects to the chat page but keeps /codex/ in the URL path so your extension can detect Codex

## Supported DOM hooks

- Composer input
  - div#prompt-textarea[data-testid="prompt-textarea"][contenteditable="true"]

- Send button
  - button[data-testid="send-button"]

- Dictation toggle
  - button[aria-label="Dictate button"]

- Submit dictation
  - button[aria-label="Submit dictation"]

- Chat list options button
  - button[data-testid^="history-item-"][data-testid$="-options"]

- Menu
  - div[role="menu"]

- Delete modal
  - div[data-testid="modal-delete-conversation-confirmation"]
  - button[data-testid="delete-conversation-confirm-button"]

- Temporary Chat checkbox
  - input#temporary-chat-checkbox
  - body.dataset.tempChat is updated to enabled or disabled
