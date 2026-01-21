import { FeatureContext, FeatureHandle } from "../application/featureContext";
import { findEditSubmitButton, ComposerInput } from "./chatgptEditor";
import { routeKeyCombos } from "./keyCombos";
import { isDisabled } from "../lib/utils";

export function initCtrlEnterSendFeature(ctx: FeatureContext): FeatureHandle {
  const norm = (value: string | null | undefined) => (value || "").trim().toLowerCase();

  const findComposerInput = (): ComposerInput | null => {
    const selectors = [
      'textarea[data-testid="prompt-textarea"]',
      '[contenteditable="true"][data-testid="prompt-textarea"]',
      "form textarea",
      'form [contenteditable="true"]',
      "footer textarea"
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el instanceof HTMLTextAreaElement) return el;
      if (el instanceof HTMLElement && el.getAttribute("contenteditable") === "true") return el;
    }
    return null;
  };

  const findActiveEditableTarget = (): ComposerInput | null => {
    const active = document.activeElement;
    if (active instanceof HTMLTextAreaElement) return active;
    if (active instanceof HTMLElement && active.isContentEditable) return active;
    return findComposerInput();
  };

  const isComposerEventTarget = (e: Event) => {
    const target = e.target;
    if (!(target instanceof Element)) return false;
    const composer = findActiveEditableTarget();
    if (!composer) return false;
    if (target === composer) return true;
    if (composer instanceof HTMLTextAreaElement) {
      const composerForm = composer.closest("form");
      if (composerForm && target.closest("form") === composerForm) return true;
    }
    if (composer instanceof HTMLElement && composer.contains(target)) return true;
    return false;
  };

  const insertNewlineAtCaret = (input: ComposerInput) => {
    if (input instanceof HTMLTextAreaElement) {
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      input.value = `${input.value.slice(0, start)}\n${input.value.slice(end)}`;
      const nextPos = start + 1;
      input.selectionStart = nextPos;
      input.selectionEnd = nextPos;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }

    const selection = input.ownerDocument.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const br = input.ownerDocument.createElement("br");
    range.insertNode(br);
    range.setStartAfter(br);
    range.setEndAfter(br);
    selection.removeAllRanges();
    selection.addRange(range);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const findSendButton = (composer?: ComposerInput | null): HTMLElement | null => {
    const selectors = [
      '[data-testid="send-button"]',
      'button[aria-label*="Send" i]',
      '[role="button"][aria-label*="Send" i]',
      'button[aria-label="Submit"]',
      '[role="button"][aria-label="Submit"]',
      'button[aria-label*="Отправ" i]'
    ];
    for (const selector of selectors) {
      const btn = document.querySelector(selector);
      if (btn instanceof HTMLElement && isVisible(btn)) return btn;
    }
    const form = composer?.closest("form");
    if (!form) return null;
    const submitBtn = form.querySelector('button[type="submit"], [role="button"][type="submit"]');
    if (submitBtn instanceof HTMLElement && isVisible(submitBtn)) return submitBtn;
    return null;
  };

  const isVisible = (btn: HTMLElement) => btn.offsetParent !== null;

  const isDictationStopButton = (btn: HTMLElement) => {
    const aria = norm(btn.getAttribute("aria-label"));
    const title = norm(btn.getAttribute("title"));
    const dt = norm(btn.getAttribute("data-testid"));
    const txt = norm(btn.textContent);
    const hay = `${aria} ${title} ${dt} ${txt}`;

    if (hay.includes("stop generating")) return false;
    if (dt.includes("stop-generating")) return false;

    if (
      hay.includes("stop dictation") ||
      hay.includes("stop recording") ||
      hay.includes("stop voice") ||
      hay.includes("stop microphone")
    )
      return true;

    if (
      hay.includes("stop") &&
      (hay.includes("dictat") ||
        hay.includes("record") ||
        hay.includes("microphone") ||
        hay.includes("voice") ||
        hay.includes("диктов") ||
        hay.includes("запис") ||
        hay.includes("голос") ||
        hay.includes("микроф"))
    )
      return true;

    return false;
  };

  const isSubmitDictationButton = (btn: HTMLElement) => {
    const aria = norm(btn.getAttribute("aria-label"));
    const title = norm(btn.getAttribute("title"));
    const dt = norm(btn.getAttribute("data-testid"));
    const txt = norm(btn.textContent);

    if (aria === "submit") {
      if (btn.classList.contains("composer-submit-btn")) return false;
      let p: HTMLElement | null = btn.parentElement;
      for (let i = 0; i < 8 && p; i += 1) {
        const hasDictateButton = !!p.querySelector(
          'button[aria-label="Dictate button"], [role="button"][aria-label="Dictate button"]'
        );
        if (hasDictateButton) return true;
        p = p.parentElement;
      }
    }

    if (aria.includes("submit dictation")) return true;
    if (
      aria.includes("dictation") &&
      (aria.includes("submit") || aria.includes("accept") || aria.includes("confirm"))
    )
      return true;

    if (aria.includes("готово")) return true;
    if (aria.includes("подтверд")) return true;
    if (aria.includes("принять")) return true;

    if (
      dt.includes("dictation") &&
      (dt.includes("submit") || dt.includes("done") || dt.includes("finish"))
    )
      return true;

    if (title.includes("submit dictation")) return true;
    if (txt.includes("submit dictation")) return true;

    return false;
  };

  const findDictationStopButton = (): HTMLElement | null => {
    const buttons = Array.from(document.querySelectorAll("button, [role='button']")).filter(
      (btn): btn is HTMLElement => btn instanceof HTMLElement
    );
    for (const btn of buttons) {
      if (!isVisible(btn)) continue;
      if (isDisabled(btn)) continue;
      if (isDictationStopButton(btn)) return btn;
    }
    return null;
  };

  const findSubmitDictationButton = (): HTMLElement | null => {
    const buttons = Array.from(document.querySelectorAll("button, [role='button']")).filter(
      (btn): btn is HTMLElement => btn instanceof HTMLElement
    );
    for (const btn of buttons) {
      if (!isVisible(btn)) continue;
      if (isDisabled(btn)) continue;
      if (isSubmitDictationButton(btn)) return btn;
    }
    return null;
  };

  const waitForInputToStabilize = (input: ComposerInput, timeoutMs: number, quietMs: number) =>
    new Promise<void>((resolve) => {
      const t0 = performance.now();
      const readInputValue = () =>
        input instanceof HTMLTextAreaElement ? input.value : input.innerText || "";
      let lastValue = readInputValue();
      let lastChangeAt = performance.now();

      const tick = () => {
        const cur = readInputValue();
        if (cur !== lastValue) {
          lastValue = cur;
          lastChangeAt = performance.now();
        }

        if (performance.now() - lastChangeAt >= quietMs) {
          resolve();
          return;
        }

        if (performance.now() - t0 >= timeoutMs) {
          resolve();
          return;
        }

        setTimeout(tick, 60);
      };

      tick();
    });

  const stopEvent = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") {
      e.stopImmediatePropagation();
    }
  };

  let lastEnterShouldSendAt = 0;
  let lastEnterShouldSend = false;
  let lastEnterShiftAt = 0;

  const handlePlainEnter = (e: KeyboardEvent, target: ComposerInput) => {
    lastEnterShouldSend = false;
    stopEvent(e);
    insertNewlineAtCaret(target);
    ctx.logger.debug("KEY", "ENTER newline");
  };

  const shouldHandleCtrlEnterOutsideComposer = () => {
    const stopBtn = findDictationStopButton();
    if (stopBtn) return true;
    const submitBtn = findSubmitDictationButton();
    if (submitBtn) return true;
    return false;
  };

  const handleCtrlEnter = (e: KeyboardEvent, target: ComposerInput) => {
    lastEnterShouldSend = true;
    lastEnterShouldSendAt = performance.now();
    stopEvent(e);
    setTimeout(() => {
      lastEnterShouldSend = false;
    }, 400);
    void (async () => {
      const editBtn = findEditSubmitButton(target);
      if (editBtn && !isDisabled(editBtn)) {
        ctx.logger.debug("KEY", "CTRL+ENTER apply edit");
        editBtn.click();
        return;
      }

      const submitBtnBefore = findSubmitDictationButton();
      if (submitBtnBefore) {
        ctx.logger.debug("KEY", "CTRL+ENTER submit dictation");
        submitBtnBefore.click();
        await waitForInputToStabilize(target, 1500, 250);
        const sendBtn = findSendButton(target);
        if (sendBtn && !isDisabled(sendBtn)) {
          ctx.logger.debug("KEY", "CTRL+ENTER send");
          sendBtn.click();
        }
        return;
      }

      const stopBtn = findDictationStopButton();
      if (stopBtn) {
        ctx.logger.debug("KEY", "CTRL+ENTER stop dictation");
        stopBtn.click();
        await waitForInputToStabilize(target, 1500, 250);
        const submitBtnAfter = findSubmitDictationButton();
        if (submitBtnAfter) {
          ctx.logger.debug("KEY", "CTRL+ENTER submit dictation after stop");
          submitBtnAfter.click();
          await waitForInputToStabilize(target, 1500, 250);
        }
        const sendBtn = findSendButton(target);
        if (sendBtn && !isDisabled(sendBtn)) {
          ctx.logger.debug("KEY", "CTRL+ENTER send");
          sendBtn.click();
        }
        return;
      }

      const sendBtn = findSendButton(target);
      if (sendBtn && !isDisabled(sendBtn)) {
        ctx.logger.debug("KEY", "CTRL+ENTER send");
        sendBtn.click();
      } else {
        ctx.logger.debug("KEY", "send button not found");
      }
    })();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!ctx.settings.ctrlEnterSends) return;
    if (e.defaultPrevented) return;
    if (e.isComposing) return;
    if (e.key !== "Enter") return;

    const shouldSend = e.ctrlKey || e.metaKey;
    const target = findActiveEditableTarget();
    const composerOk =
      !!target && (isComposerEventTarget(e) || shouldHandleCtrlEnterOutsideComposer());

    if (!composerOk) return;
    if (!shouldSend && e.shiftKey) {
      lastEnterShiftAt = performance.now();
      return;
    }
    if (shouldSend) {
      handleCtrlEnter(e, target);
      return;
    }

    if (!target) return;
    routeKeyCombos(e, [
      {
        key: "Enter",
        ctrl: false,
        meta: false,
        shift: false,
        alt: false,
        priority: 1,
        handler: () => handlePlainEnter(e, target)
      }
    ]);
  };

  const handleBeforeInput = (e: InputEvent) => {
    if (!ctx.settings.ctrlEnterSends) return;
    if (e.defaultPrevented) return;
    if (e.inputType !== "insertParagraph") return;
    if (!isComposerEventTarget(e)) return;

    const ageMs = performance.now() - lastEnterShouldSendAt;
    if (lastEnterShouldSend && ageMs < 300) return;
    if (performance.now() - lastEnterShiftAt < 300) return;

    stopEvent(e);
    const target = e.target;
    if (!(target instanceof HTMLTextAreaElement || target instanceof HTMLElement)) return;
    insertNewlineAtCaret(target);
    ctx.logger.debug("KEY", "BEFOREINPUT newline");
  };

  window.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("beforeinput", handleBeforeInput, true);

  return {
    name: "ctrlEnterSend",
    dispose: () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("beforeinput", handleBeforeInput, true);
    },
    getStatus: () => ({ active: ctx.settings.ctrlEnterSends })
  };
}
