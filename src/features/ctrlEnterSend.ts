import { FeatureContext, FeatureHandle } from "../application/featureContext";
import { findAnyEditSubmitButton, findEditSubmitButton, ComposerInput } from "./chatgptEditor";
import { routeKeyCombos } from "./keyCombos";
import { isDisabled } from "../lib/utils";

export function initCtrlEnterSendFeature(ctx: FeatureContext): FeatureHandle {
  const norm = (value: string | null | undefined) => (value || "").trim().toLowerCase();
  const isVisible = (btn: HTMLElement) => btn.offsetParent !== null;

  const DBG_PREFIX = "[TM][edit]";
  const isEditTraceEnabled = () =>
    !!ctx.settings.debugAutoExpandProjects && ctx.settings.debugTraceTarget === "editMessage";

  const dbg = (msg: string, data?: Record<string, unknown>) => {
    if (!isEditTraceEnabled()) return;
    if (data) console.log(`${DBG_PREFIX} ${msg}`, data);
    else console.log(`${DBG_PREFIX} ${msg}`);
  };

  const describeBtn = (el: HTMLElement | null) => {
    if (!el) return "null";
    const tag = el.tagName ? el.tagName.toLowerCase() : "el";
    const id = (el as HTMLElement).id ? `#${(el as HTMLElement).id}` : "";
    const dt = (el.getAttribute("data-testid") || "").trim();
    const aria = (el.getAttribute("aria-label") || "").trim();
    const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
    const bits: string[] = [`${tag}${id}`];
    if (dt) bits.push(`data-testid=${dt}`);
    if (aria) bits.push(`aria="${aria.slice(0, 80)}"`);
    if (text) bits.push(`text="${text}"`);
    return bits.join(" ");
  };

  const click = (el: HTMLElement | null, why: string) => {
    const ok = ctx.helpers.humanClick(el, why);
    if (!ok && el) {
      try {
        el.click();
        return true;
      } catch {
        return false;
      }
    }
    return ok;
  };

  const readInputValue = (input: ComposerInput) => {
    if (input instanceof HTMLTextAreaElement) return input.value || "";
    return input.innerText || input.textContent || "";
  };

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

    if (document.activeElement !== input) {
      input.focus();
    }

    const doc = input.ownerDocument;
    const canExec = typeof doc.execCommand === "function";
    if (canExec) {
      try {
        if (doc.execCommand("insertLineBreak")) return;
      } catch {
        // ignore and fall back
      }

      try {
        if (doc.execCommand("insertText", false, "\n")) return;
      } catch {
        // ignore and fall back
      }
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

    const tryFindIn = (root: ParentNode): HTMLElement | null => {
      for (const selector of selectors) {
        const btn = root.querySelector(selector);
        if (btn instanceof HTMLElement && isVisible(btn)) return btn;
      }
      return null;
    };

    const form = composer?.closest("form");
    if (form) {
      const inside = tryFindIn(form);
      if (inside) return inside;

      const submitBtn = form.querySelector('button[type="submit"], [role="button"][type="submit"]');
      if (submitBtn instanceof HTMLElement && isVisible(submitBtn)) return submitBtn;
    }

    return tryFindIn(document);
  };

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

  const findComposerScope = () => {
    const composer = findComposerInput();
    const form = composer?.closest("form");
    return form ?? composer?.closest("footer") ?? document;
  };

  const findDictationStopButton = (): HTMLElement | null => {
    const buttons = Array.from(
      findComposerScope().querySelectorAll("button, [role='button']")
    ).filter((btn): btn is HTMLElement => btn instanceof HTMLElement);
    for (const btn of buttons) {
      if (!isVisible(btn)) continue;
      if (isDisabled(btn)) continue;
      if (isDictationStopButton(btn)) return btn;
    }
    if (findComposerScope() !== document) {
      const fallback = Array.from(document.querySelectorAll("button, [role='button']")).filter(
        (btn): btn is HTMLElement => btn instanceof HTMLElement
      );
      for (const btn of fallback) {
        if (!isVisible(btn)) continue;
        if (isDisabled(btn)) continue;
        if (isDictationStopButton(btn)) return btn;
      }
    }
    return null;
  };

  const findSubmitDictationButton = (): HTMLElement | null => {
    const buttons = Array.from(
      findComposerScope().querySelectorAll("button, [role='button']")
    ).filter((btn): btn is HTMLElement => btn instanceof HTMLElement);
    for (const btn of buttons) {
      if (!isVisible(btn)) continue;
      if (isDisabled(btn)) continue;
      if (isSubmitDictationButton(btn)) return btn;
    }
    if (findComposerScope() !== document) {
      const fallback = Array.from(document.querySelectorAll("button, [role='button']")).filter(
        (btn): btn is HTMLElement => btn instanceof HTMLElement
      );
      for (const btn of fallback) {
        if (!isVisible(btn)) continue;
        if (isDisabled(btn)) continue;
        if (isSubmitDictationButton(btn)) return btn;
      }
    }
    return null;
  };

  const waitForTextToChangeFrom = (
    input: ComposerInput,
    baseline: string,
    timeoutMs: number,
    pollMs: number,
    onPoll?: () => void
  ) =>
    new Promise<boolean>((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        onPoll?.();
        const cur = readInputValue(input);
        if (cur !== baseline) {
          resolve(true);
          return;
        }
        if (performance.now() - t0 >= timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(tick, pollMs);
      };
      tick();
    });

  const waitForNonEmptyStableText = (
    input: ComposerInput,
    timeoutMs: number,
    quietMs: number,
    onPoll?: () => void
  ) =>
    new Promise<string>((resolve) => {
      const t0 = performance.now();
      let lastValue = readInputValue(input);
      let lastChangeAt = performance.now();

      const tick = () => {
        onPoll?.();
        const cur = readInputValue(input);
        if (cur !== lastValue) {
          lastValue = cur;
          lastChangeAt = performance.now();
        }

        const stableForMs = performance.now() - lastChangeAt;
        const hasText = cur.trim().length > 0;

        if (hasText && stableForMs >= quietMs) {
          resolve(cur);
          return;
        }

        if (performance.now() - t0 >= timeoutMs) {
          resolve(cur);
          return;
        }

        setTimeout(tick, 60);
      };

      tick();
    });

  const waitForSendButtonReady = (
    composer: ComposerInput,
    timeoutMs: number,
    pollMs: number
  ): Promise<HTMLElement | null> =>
    new Promise((resolve) => {
      const t0 = performance.now();

      const tick = () => {
        const btn = findSendButton(composer);
        if (btn && !isDisabled(btn)) {
          resolve(btn);
          return;
        }

        if (performance.now() - t0 >= timeoutMs) {
          resolve(null);
          return;
        }

        setTimeout(tick, pollMs);
      };

      tick();
    });

  const waitForFinalTranscribedText = async (input: ComposerInput, baseline: string) => {
    let submitClicked = false;
    const trySubmitDictation = () => {
      if (submitClicked) return;
      const btn = findSubmitDictationButton();
      if (btn) {
        const ok = click(btn, "submit-dictation-auto");
        if (ok) submitClicked = true;
      }
    };

    await new Promise((r) => setTimeout(r, 80));
    trySubmitDictation();

    if (baseline.trim().length > 0) {
      await waitForTextToChangeFrom(input, baseline, 4000, 80, trySubmitDictation);
    }

    return await waitForNonEmptyStableText(input, 25000, 450, trySubmitDictation);
  };

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
    // For ChatGPT's contenteditable composer, manual DOM insertion (br or newline) is unreliable.
    // Simulate Shift+Enter so the page's own handlers create a stable line break.
    lastEnterShouldSend = false;
    stopEvent(e);

    const baseline = readInputValue(target);

    // For a plain <textarea>, our newline insertion is reliable and avoids re-dispatching.
    if (target instanceof HTMLTextAreaElement) {
      insertNewlineAtCaret(target);
      ctx.logger.debug("KEY", "ENTER newline (textarea)");
      return;
    }

    try {
      const ev = new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
        shiftKey: true,
        ctrlKey: false,
        metaKey: false,
        altKey: false
      });
      target.dispatchEvent(ev);
    } catch {
      // ignore and fall back below
    }

    // Fallback: if ChatGPT didn't insert anything, do a conservative manual insert.
    setTimeout(() => {
      if (readInputValue(target) === baseline) {
        insertNewlineAtCaret(target);
        ctx.logger.debug("KEY", "ENTER newline (fallback)");
      } else {
        ctx.logger.debug("KEY", "ENTER newline (shift-dispatch)");
      }
    }, 0);
  };

  const shouldHandleCtrlEnterOutsideComposer = () => {
    const stopBtn = findDictationStopButton();
    if (stopBtn) return true;
    const submitBtn = findSubmitDictationButton();
    if (submitBtn) return true;
    return false;
  };

  const handleCtrlEnter = (e: KeyboardEvent, target: ComposerInput | null) => {
    lastEnterShouldSend = true;
    lastEnterShouldSendAt = performance.now();
    stopEvent(e);
    setTimeout(() => {
      lastEnterShouldSend = false;
    }, 400);

    void (async () => {
      const composer = target ?? findComposerInput();
      if (composer) {
        const editBtn = findEditSubmitButton(composer);
        if (editBtn && !isDisabled(editBtn)) {
          ctx.logger.debug("KEY", "CTRL+ENTER apply edit");
          dbg("CTRL+ENTER apply edit", { btn: describeBtn(editBtn) });
          click(editBtn, "apply-edit");
          return;
        }
      }

      const anyEditBtn = findAnyEditSubmitButton();
      if (anyEditBtn && !isDisabled(anyEditBtn)) {
        ctx.logger.debug("KEY", "CTRL+ENTER apply edit (global)");
        dbg("CTRL+ENTER apply edit (global)", { btn: describeBtn(anyEditBtn) });
        click(anyEditBtn, "apply-edit-global");
        return;
      }

      const baseline = composer ? readInputValue(composer) : "";

      const submitBtnBefore = findSubmitDictationButton();
      if (submitBtnBefore) {
        ctx.logger.debug("KEY", "CTRL+ENTER submit dictation");
        click(submitBtnBefore, "submit-dictation");
        if (composer) {
          await waitForFinalTranscribedText(composer, baseline);
          const sendBtn = await waitForSendButtonReady(composer, 12000, 80);
          if (sendBtn) {
            ctx.logger.debug("KEY", "CTRL+ENTER send");
            click(sendBtn, "send");
          } else {
            ctx.logger.debug("KEY", "send button not ready");
          }
        }
        return;
      }

      const stopBtn = findDictationStopButton();
      if (stopBtn) {
        ctx.logger.debug("KEY", "CTRL+ENTER stop dictation");
        click(stopBtn, "stop-dictation");
        if (composer) {
          await waitForFinalTranscribedText(composer, baseline);
          const sendBtn = await waitForSendButtonReady(composer, 12000, 80);
          if (sendBtn) {
            ctx.logger.debug("KEY", "CTRL+ENTER send");
            click(sendBtn, "send");
          } else {
            ctx.logger.debug("KEY", "send button not ready");
          }
        }
        return;
      }

      const sendBtn = findSendButton(composer ?? undefined);
      if (sendBtn && !isDisabled(sendBtn)) {
        ctx.logger.debug("KEY", "CTRL+ENTER send");
        dbg("CTRL+ENTER send (fallback)", { btn: describeBtn(sendBtn) });
        click(sendBtn, "send");
      } else {
        ctx.logger.debug("KEY", "send button not found");
      }
    })();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!ctx.settings.ctrlEnterSends) return;
    if (!e.isTrusted) return;
    if (e.isComposing && !(e.ctrlKey || e.metaKey)) return;
    if (e.key !== "Enter") return;

    const shouldSend = e.ctrlKey || e.metaKey;

    // ChatGPT sometimes prevents default on Ctrl/Cmd+Enter before our capture handler runs.
    // We still want to click the correct "apply edit" action instead of falling back to normal send.
    if (!shouldSend && e.defaultPrevented) return;

    const target = findActiveEditableTarget();
    const hasDictationControls = shouldHandleCtrlEnterOutsideComposer();
    const canSendFromOutside = shouldSend && !!findSendButton(target ?? undefined);
    const composerOk =
      (!!target && isComposerEventTarget(e)) || hasDictationControls || canSendFromOutside;

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
    if (!e.isTrusted) return;
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
