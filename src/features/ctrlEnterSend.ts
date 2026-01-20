import { FeatureContext, FeatureHandle } from "../application/featureContext";

export function initCtrlEnterSendFeature(ctx: FeatureContext): FeatureHandle {
  const norm = (value: string | null | undefined) => (value || "").trim().toLowerCase();
  type ComposerInput = HTMLTextAreaElement | HTMLElement;

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

  const findEditSubmitButton = (composer: ComposerInput) => {
    const closestForm = composer.closest("form");
    if (closestForm) {
      const submitBtn = closestForm.querySelector('button[type="submit"]');
      if (submitBtn instanceof HTMLButtonElement) return submitBtn;
    }

    const searchRoots: Array<Element | null> = [
      composer.closest('[role="dialog"], [role="alertdialog"]'),
      composer.closest("article"),
      composer.closest("[data-message-author-role]"),
      composer.closest('[data-testid*="message" i]'),
      composer.closest("div")
    ];

    const root = searchRoots.find((x): x is Element => !!x) ?? null;
    if (!root) return null;

    const buttons = Array.from(root.querySelectorAll("button")).filter(
      (btn): btn is HTMLButtonElement => btn instanceof HTMLButtonElement
    );

    const positive = [
      "save",
      "save and submit",
      "submit",
      "apply",
      "update",
      "done",
      "ok",
      "сохранить",
      "сохран",
      "применить",
      "готово"
    ];

    const negative = ["cancel", "close", "dismiss", "отмена", "отменить"];

    const candidates = buttons
      .filter((btn) => {
        if (btn.disabled) return false;
        const aria = norm(btn.getAttribute("aria-label"));
        const title = norm(btn.getAttribute("title"));
        const dt = norm(btn.getAttribute("data-testid"));
        const txt = norm(btn.textContent);
        const hay = `${aria} ${title} ${dt} ${txt}`;
        if (negative.some((x) => hay.includes(x))) return false;
        return positive.some((x) => hay.includes(x));
      })
      .filter((btn) => btn.offsetParent !== null);

    if (candidates.length > 0) return candidates[0];

    const byTestId = buttons.find((btn) => {
      const dt = norm(btn.getAttribute("data-testid"));
      if (!dt) return false;
      if (dt.includes("save")) return true;
      if (dt.includes("submit")) return true;
      if (dt.includes("apply")) return true;
      if (dt.includes("update")) return true;
      return false;
    });

    return byTestId ?? null;
  };

  const findSendButton = (composer?: ComposerInput | null) => {
    if (composer) {
      const editBtn = findEditSubmitButton(composer);
      if (editBtn) return editBtn;
    }

    const selectors = [
      'button[data-testid="send-button"]',
      'button[aria-label*="Send" i]',
      'button[aria-label*="Отправ" i]'
    ];
    for (const selector of selectors) {
      const btn = document.querySelector(selector);
      if (btn instanceof HTMLButtonElement) return btn;
    }
    const form = composer?.closest("form");
    if (!form) return null;
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn instanceof HTMLButtonElement) return submitBtn;
    return null;
  };

  const isVisible = (btn: HTMLButtonElement) => btn.offsetParent !== null;

  const isDictationStopButton = (btn: HTMLButtonElement) => {
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

  const findDictationStopButton = () => {
    const buttons = Array.from(document.querySelectorAll("button")).filter(
      (btn): btn is HTMLButtonElement => btn instanceof HTMLButtonElement
    );
    for (const btn of buttons) {
      if (!isVisible(btn)) continue;
      if (btn.disabled) continue;
      if (isDictationStopButton(btn)) return btn;
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

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!ctx.settings.ctrlEnterSends) return;
    if (e.defaultPrevented) return;
    if (e.isComposing) return;
    if (e.key !== "Enter") return;
    if (!isComposerEventTarget(e)) return;

    const target = e.target;
    if (!(target instanceof HTMLTextAreaElement || target instanceof HTMLElement)) return;
    const shouldSend = e.ctrlKey || e.metaKey;
    if (shouldSend) {
      lastEnterShouldSend = true;
      lastEnterShouldSendAt = performance.now();
      stopEvent(e);
      setTimeout(() => {
        lastEnterShouldSend = false;
      }, 400);
      void (async () => {
        const stopBtn = findDictationStopButton();
        if (stopBtn) {
          ctx.logger.debug("KEY", "CTRL+ENTER stop dictation");
          stopBtn.click();
          await waitForInputToStabilize(target, 1500, 250);
        }
        const btn = findSendButton(target);
        if (btn && !btn.disabled) {
          ctx.logger.debug("KEY", "CTRL+ENTER send");
          btn.click();
        } else {
          ctx.logger.debug("KEY", "send button not found");
        }
      })();
      return;
    }

    lastEnterShouldSend = false;
    stopEvent(e);
    insertNewlineAtCaret(target);
    ctx.logger.debug("KEY", "ENTER newline");
  };

  const handleBeforeInput = (e: InputEvent) => {
    if (!ctx.settings.ctrlEnterSends) return;
    if (e.defaultPrevented) return;
    if (e.inputType !== "insertParagraph") return;
    if (!isComposerEventTarget(e)) return;

    const ageMs = performance.now() - lastEnterShouldSendAt;
    if (lastEnterShouldSend && ageMs < 300) return;

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
