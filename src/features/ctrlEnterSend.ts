import { FeatureContext, FeatureHandle } from "../application/featureContext";

export function initCtrlEnterSendFeature(ctx: FeatureContext): FeatureHandle {
  const norm = (value: string | null | undefined) => (value || "").trim().toLowerCase();

  const findComposerTextarea = () => {
    const selectors = [
      'textarea[data-testid="prompt-textarea"]',
      "form textarea",
      "footer textarea"
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el instanceof HTMLTextAreaElement) return el;
    }
    return null;
  };

  const isComposerEventTarget = (e: KeyboardEvent) => {
    const target = e.target;
    if (!(target instanceof HTMLTextAreaElement)) return false;
    const composer = findComposerTextarea();
    if (!composer) return false;
    if (target === composer) return true;
    const composerForm = composer.closest("form");
    if (composerForm && target.closest("form") === composerForm) return true;
    return false;
  };

  const insertNewlineAtCaret = (textarea: HTMLTextAreaElement) => {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    textarea.value = `${textarea.value.slice(0, start)}\n${textarea.value.slice(end)}`;
    const nextPos = start + 1;
    textarea.selectionStart = nextPos;
    textarea.selectionEnd = nextPos;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const findSendButton = (composer?: HTMLTextAreaElement | null) => {
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

  const waitForInputToStabilize = (
    textarea: HTMLTextAreaElement,
    timeoutMs: number,
    quietMs: number
  ) =>
    new Promise<void>((resolve) => {
      const t0 = performance.now();
      let lastValue = textarea.value;
      let lastChangeAt = performance.now();

      const tick = () => {
        const cur = textarea.value;
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

  const stopEvent = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") {
      e.stopImmediatePropagation();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!ctx.settings.ctrlEnterSends) return;
    if (e.defaultPrevented) return;
    if (e.isComposing) return;
    if (e.key !== "Enter") return;
    if (!isComposerEventTarget(e)) return;

    const target = e.target as HTMLTextAreaElement;
    const shouldSend = e.ctrlKey || e.metaKey;
    if (shouldSend) {
      stopEvent(e);
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

    stopEvent(e);
    insertNewlineAtCaret(target);
    ctx.logger.debug("KEY", "ENTER newline");
  };

  window.addEventListener("keydown", handleKeyDown, true);

  return {
    name: "ctrlEnterSend",
    dispose: () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    },
    getStatus: () => ({ active: ctx.settings.ctrlEnterSends })
  };
}
