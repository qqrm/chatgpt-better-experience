# AutoSend + CtrlEnterSend Specification

## 1) Overview

This document specifies the intended behavior for the AutoSend and CtrlEnterSend features in the
ChatGPT/Codex extension.

- **AutoSend**: When enabled, automatically clicks **Send** after a user **mouse-clicks** the
  “Submit dictation” checkmark, the final dictation text stabilizes, and a short grace countdown
  completes (default: 3s). During the countdown, Shift cancels the send for the in-flight submit.
- **CtrlEnterSend**: When enabled, uses **Ctrl+Enter / Cmd+Enter** to send in normal mode, finish
  dictation before sending when dictation UI is visible, and apply edits in edit mode.

## 2) Definitions

- **Composer**: the message input area (`textarea` or `contenteditable=true`).
- **Normal mode**: composing a new message in the composer.
- **Edit mode**: editing a previously sent user message (opened via ArrowUp or an Edit button).
- **Dictation UI states**:
  - **NONE**: no dictation controls visible
  - **STOP**: “Stop dictation/recording” visible
  - **SUBMIT**: “Submit dictation” checkmark visible
- **Buttons**:
  - **Send button**: sends a new message in normal mode
  - **Stop dictation button**: stops recording
  - **Submit dictation button**: confirms dictation transcript
  - **Edit apply button**: applies edits in edit mode

## 3) Baseline website behavior (informational)

When the extension does not intercept, the site baseline behavior is assumed to be:

- **Enter**: send message
- **Shift+Enter**: insert newline

## 4) Invariants

- **I1. No interference**: when `autoSendEnabled == false` **and** `ctrlEnterSends == false`, the
  extension must not affect user input or clicks. It must not prevent default actions, stop
  propagation, programmatically click buttons, or modify input values.
- **I2. Baseline dependency**: Enter sends; Shift+Enter inserts a newline when the extension does
  not intercept.
- **I3. AutoSend scope**: AutoSend only responds to **trusted mouse clicks** on the Submit
  dictation button (mouse event `detail > 0`). It must not trigger from keyboard actions,
  untrusted clicks, or when disabled.
- **I4. CtrlEnterSend scope**: CtrlEnterSend handles Ctrl+Enter / Cmd+Enter only. It does not call
  AutoSend logic and has its own dictation finishing pipeline.
- **I5. No double action**: one user action must trigger at most one send or apply.
- **I6. Edit mode priority**: in edit mode, Ctrl+Enter applies the edit and does not trigger
  dictation finishing or new send.
- **I7. Shift cancels AutoSend**: AutoSend is canceled for the **current submit click** when
  Shift is held at click time or Shift is pressed after the click while AutoSend is waiting for
  the final transcript, during the grace countdown, or while preparing to send. This “grace window”
  lasts until the flow ends and applies only to the in-flight submit action (no global disable).
- **I8. Countdown indicator**: When AutoSend is enabled and an in-flight submit click reaches the
  grace countdown, the extension shows a small, non-interactive countdown indicator near the composer
  controls (next to mic/send). It must not steal focus or accept pointer input, and it must be
  hidden when not in the countdown state.

## 5) Behavior matrix (baseline vs extension overrides)

The matrix below describes behavior by mode, dictation state, settings, and user action.

### A) Normal mode, dictation NONE

**CtrlEnterSend OFF**

- Enter → **baseline** (site sends)
- Shift+Enter → **baseline** (site inserts newline)
- Ctrl+Enter / Cmd+Enter → **baseline** (site-defined)

**CtrlEnterSend ON**

- Enter → **extension override**: insert newline
- Shift+Enter → **baseline** (do not intercept)
- Ctrl+Enter / Cmd+Enter → **extension override**: click Send

> AutoSend setting does not matter in dictation NONE cases.

### B) Normal mode, dictation STOP visible

**CtrlEnterSend OFF**

- All actions → **baseline** (no interception)

**CtrlEnterSend ON**

- Ctrl+Enter / Cmd+Enter → **extension override**:
  1. intercept (prevent default + stop propagation)
  2. click Stop dictation
  3. wait for input stabilization
  4. if Submit appears, click Submit dictation
  5. wait for stabilization
  6. click Send

### C) Normal mode, dictation SUBMIT visible

**Mouse click Submit dictation**

- AutoSend OFF → **baseline** (confirm dictation only)
- AutoSend ON → **extension override**:
  1. if Shift was held at click time, or Shift is pressed after the click while AutoSend waits for
     the final text, during the countdown, and before Send → confirm dictation only (do not send)
     for this submit click
  2. otherwise wait for final dictation text to stabilize
  3. start a grace countdown (default: 3 seconds) and show a countdown indicator near mic/send
  4. when the countdown completes, click Send

**Keyboard activation of Submit dictation** (`MouseEvent.detail == 0`)

- AutoSend ON or OFF → **baseline** (confirm dictation only)

**Ctrl+Enter / Cmd+Enter**

- CtrlEnterSend OFF → **baseline** (do not intercept)
- CtrlEnterSend ON → **extension override**:
  1. intercept (prevent default + stop propagation)
  2. click Submit dictation
  3. wait for stabilization
  4. click Send

### D) Edit mode (editing a previous user message)

**CtrlEnterSend OFF**

- All actions → **baseline** (no interception)

**CtrlEnterSend ON**

- Ctrl+Enter / Cmd+Enter → **extension override**: click Edit apply
- Enter → **extension override**: insert newline (do not apply)
- Shift+Enter → **baseline** (do not intercept)

Dictation UI presence does not override edit mode priority.

### E) ArrowUp behavior (enter edit mode)

**Composer empty + ArrowUp**

- **extension override**:
  1. find last user message
  2. scroll it to the center of the viewport
  3. click Edit
  4. wait for edit input (textarea or contenteditable)
  5. focus input and move cursor to the end
  6. scroll to center again after edit input appears

**Composer not empty + ArrowUp**

- **baseline** (no interception)

## 6) Responsibility split

- `src/features/dictationAutoSend.ts`: AutoSend only (trusted mouse click on Submit dictation).
- `src/features/ctrlEnterSend.ts`: Ctrl+Enter / Cmd+Enter behavior, including dictation finishing.
- `src/features/editLastMessage.ts`: ArrowUp edit UX (scroll, focus, caret at end).
- `src/features/chatgptEditor.ts`: Edit apply button detection.

## 7) Testing strategy

- Prefer deterministic unit/integration tests (Vitest + jsdom) for AutoSend state and DOM behavior.
- Avoid Playwright E2E against ChatGPT: it is commonly blocked by anti-automation measures and is
  not a reliable regression signal for this project.
