import { DictationInputKind } from "../domain/dictation";
import { FeatureContext, FeatureHandle, LogFields } from "../application/featureContext";
import { isDisabled, isElementVisible, isVisible, norm } from "../lib/utils";

interface DictationConfig {
  autoSendEnabled: boolean;
  allowAutoSendInCodex: boolean;
  finalTextTimeoutMs: number;
  finalTextQuietMs: number;
  sendAckTimeoutMs: number;
  logClicks: boolean;
}

interface InputReadResult {
  ok: boolean;
  kind: DictationInputKind;
  text: string;
}

interface WaitForFinalTextArgs {
  snapshot: string;
  timeoutMs: number;
  quietMs: number;
}

interface WaitForFinalTextResult extends InputReadResult {
  ok: boolean;
  inputOk: boolean;
}

type DictationUiState = "NONE" | "STOP" | "SUBMIT";

const TRANSCRIBE_HOOK_SOURCE = "tm-dictation-transcribe";

const DEFAULT_CONFIG: DictationConfig = {
  autoSendEnabled: true,
  allowAutoSendInCodex: true,
  finalTextTimeoutMs: 25000,
  finalTextQuietMs: 320,
  sendAckTimeoutMs: 4500,
  logClicks: true
};
const DICTATION_COOLDOWN_MS = 400;
const AUTO_SEND_COOLDOWN_MS = 2000;

export function shouldAutoSendFromSubmitClick(e: Pick<MouseEvent, "isTrusted" | "detail"> | null) {
  if (!e?.isTrusted) return false;
  return (e.detail ?? 0) > 0;
}

export function initDictationAutoSendFeature(ctx: FeatureContext): FeatureHandle {
  const cfg: DictationConfig = { ...DEFAULT_CONFIG };

  let inFlight = false;
  let transcribeHookInstalled = false;
  let lastDictationToggleAt = 0;
  let lastState: DictationUiState = "NONE";
  let lastStateChangedAt = performance.now();
  let lastSubmitSeenAt = 0;
  let lastAutoSendTriggeredAt = 0;
  let lastShiftCancelAt = 0;
  let lastTranscribeCompleteAt = 0;
  let lastTranscriptId = "";

  let composerFooterObserver: MutationObserver | null = null;
  let composerRootObserver: MutationObserver | null = null;
  let composerFooterNode: HTMLElement | null = null;

  const tmLog = (msg: string, fields?: LogFields) => {
    const input = readInputText();
    const payload = {
      state: getDictationUiState(),
      inputLen: input.text.length,
      preview: short(input.text),
      transcriptId: lastTranscriptId || undefined,
      transcribeCompleteAt: lastTranscribeCompleteAt || undefined,
      ...fields
    };
    console.debug("[cgptbe][dictation]", msg, payload);
  };

  const qs = <T extends Element = Element>(sel: string, root: Document | Element = document) =>
    root.querySelector<T>(sel);

  const qsa = <T extends Element = Element>(sel: string, root: Document | Element = document) =>
    Array.from(root.querySelectorAll<T>(sel));

  const short = (value: string, n = 140) => {
    if (value == null) return "";
    const t = String(value).replace(/\s+/g, " ").trim();
    if (t.length <= n) return t;
    return t.slice(0, n) + "...";
  };

  const describeEl = (el: Element | null) => {
    if (!el) return "null";
    const tag = el.tagName ? el.tagName.toLowerCase() : "node";
    const id = (el as HTMLElement).id ? `#${(el as HTMLElement).id}` : "";
    const dt = el.getAttribute ? el.getAttribute("data-testid") : "";
    const aria = el.getAttribute ? el.getAttribute("aria-label") : "";
    const title = el.getAttribute ? el.getAttribute("title") : "";
    const txt = el.textContent ? short(el.textContent, 60) : "";
    const bits: string[] = [];
    bits.push(`${tag}${id}`);
    if (dt) bits.push(`data-testid=${dt}`);
    if (aria) bits.push(`aria="${short(aria, 60)}"`);
    if (title) bits.push(`title="${short(title, 60)}"`);
    if (txt) bits.push(`text="${txt}"`);
    return bits.join(" ");
  };

  const applySettings = () => {
    cfg.autoSendEnabled = ctx.settings.autoSend;
    cfg.allowAutoSendInCodex = ctx.settings.allowAutoSendInCodex;
  };

  const findTextbox = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      const ce = active.getAttribute("contenteditable");
      if (ce === "true") return active;
    }

    const byId = document.getElementById("prompt-textarea");
    if (byId instanceof HTMLElement && byId.getAttribute("contenteditable") === "true") {
      return byId;
    }

    const byTestId = document.querySelector('[data-testid="prompt-textarea"]');
    if (byTestId instanceof HTMLElement) return byTestId;

    const textarea = document.querySelector("textarea");
    if (textarea instanceof HTMLTextAreaElement) return textarea;

    const anyCe = document.querySelector('[contenteditable="true"]');
    if (anyCe instanceof HTMLElement) return anyCe;

    return null;
  };

  const findComposerInput = () => {
    const byId = document.getElementById("prompt-textarea");
    if (byId instanceof HTMLTextAreaElement) return byId;
    if (byId instanceof HTMLElement && byId.getAttribute("contenteditable") === "true") {
      return byId;
    }

    const byTestId = document.querySelector('[data-testid="prompt-textarea"]');
    if (byTestId instanceof HTMLTextAreaElement) return byTestId;
    if (byTestId instanceof HTMLElement && byTestId.getAttribute("contenteditable") === "true") {
      return byTestId;
    }

    const textarea = document.querySelector("textarea");
    if (textarea instanceof HTMLTextAreaElement) return textarea;

    return null;
  };

  const readTextboxText = (el: HTMLTextAreaElement | HTMLElement | null) => {
    if (!el) return "";
    if (el instanceof HTMLTextAreaElement) return el.value || "";
    return String(el.innerText || el.textContent || "").replace(/\u00A0/g, " ");
  };

  const readInputText = (): InputReadResult => {
    const el = findTextbox();
    if (!el) return { ok: false, kind: "none", text: "" };
    const kind: DictationInputKind =
      el instanceof HTMLTextAreaElement ? "textarea" : "contenteditable";
    return { ok: true, kind, text: readTextboxText(el) };
  };

  const findSendButton = (): HTMLElement | null =>
    qs<HTMLElement>('[data-testid="send-button"]') ||
    qs<HTMLElement>("#composer-submit-button") ||
    qs<HTMLElement>("button.composer-submit-btn") ||
    qs<HTMLElement>("form button[type='submit']") ||
    qs<HTMLElement>('button[aria-label*="Send"]') ||
    qs<HTMLElement>('[role="button"][aria-label*="Send"]') ||
    qs<HTMLElement>('button[aria-label*="Отправ"]') ||
    null;

  const isSubmitDictationButton = (btn: Element | null) => {
    if (!btn) return false;

    const aRaw = btn.getAttribute("aria-label");
    const tRaw = btn.getAttribute("title");
    const dtRaw = btn.getAttribute("data-testid");
    const txtRaw = btn.textContent;

    const a = norm(aRaw).trim();
    const t = norm(tRaw).trim();
    const dt = norm(dtRaw).trim();
    const txt = norm(txtRaw).trim();

    if (a === "submit" || a === "done" || t === "done" || txt === "done") {
      if (btn.classList.contains("composer-submit-btn")) return false;
      if (hasDictationButtonNearby(btn)) return true;

      // ChatGPT UI can temporarily replace the dictation toggle with submit/cancel buttons,
      // so the "near dictation button" heuristic may fail. Treat Submit/Done as dictation
      // submit when the button is part of the composer UI.
      const promptEl =
        document.getElementById("prompt-textarea") ||
        document.querySelector('[data-testid="prompt-textarea"]');
      const parentForm = btn.closest("form");
      const inComposerFooter = !!btn.closest('[data-testid="composer-footer-actions"]');
      const inComposerForm = !!(promptEl && parentForm && parentForm.contains(promptEl));
      if (inComposerFooter || inComposerForm) return true;
    }

    if (a.includes("submit dictation")) return true;
    if (
      a.includes("dictation") &&
      (a.includes("submit") || a.includes("accept") || a.includes("confirm"))
    )
      return true;

    if (a.includes("готово")) return true;
    if (a.includes("подтверд")) return true;
    if (a.includes("принять")) return true;

    if (
      dt.includes("dictation") &&
      (dt.includes("submit") || dt.includes("done") || dt.includes("finish"))
    )
      return true;

    if (t.includes("submit dictation")) return true;
    if (txt.includes("submit dictation")) return true;

    return false;
  };

  const isSendButton = (btn: Element | null) => {
    if (!btn) return false;
    const sendBtn = findSendButton();
    if (sendBtn && btn === sendBtn) return true;
    if (btn instanceof HTMLButtonElement) {
      const type = norm(btn.getAttribute("type"));
      if (type === "submit") return true;
      if (btn.closest("form")) return true;
    }
    const dt = norm(btn.getAttribute("data-testid"));
    const aria = norm(btn.getAttribute("aria-label"));
    const title = norm(btn.getAttribute("title"));
    if (dt.includes("send")) return true;
    if (aria.includes("send")) return true;
    if (aria.includes("отправ")) return true;
    if (title.includes("send")) return true;
    if (title.includes("отправ")) return true;
    return false;
  };

  const isInterestingButton = (btn: Element | null) => {
    if (!btn) return false;
    const a = norm(btn.getAttribute("aria-label"));
    const t = norm(btn.getAttribute("title"));
    const dt = norm(btn.getAttribute("data-testid"));
    if (dt.includes("send") || dt.includes("stop") || dt.includes("voice") || dt.includes("dict"))
      return true;
    if (a.includes("send") || a.includes("stop") || a.includes("dictat") || a.includes("voice"))
      return true;
    if (
      a.includes("отправ") ||
      a.includes("останов") ||
      a.includes("диктов") ||
      a.includes("микроф")
    )
      return true;
    if (t.includes("send") || t.includes("stop") || t.includes("voice") || t.includes("dict"))
      return true;
    return false;
  };

  const isCodexPath = (pathname: string) =>
    pathname.includes("/codex") || pathname.includes("/codecs");

  const findStopGeneratingButton = () => {
    const candidates = qsa<HTMLElement>("button, [role='button']").filter((b) => {
      const a = norm(b.getAttribute("aria-label"));
      const t = norm(b.getAttribute("title"));
      const dt = norm(b.getAttribute("data-testid"));
      if (dt.includes("stop")) return true;
      if (a.includes("stop generating")) return true;
      if (a.includes("stop")) return true;
      if (a.includes("останов")) return true;
      if (t.includes("stop")) return true;
      if (t.includes("останов")) return true;
      return false;
    });
    for (const b of candidates) {
      if (isVisible(b)) return b;
    }
    return null;
  };

  const isDictationHotkey = (e: KeyboardEvent) => e.code === "Space" && (e.ctrlKey || e.metaKey);

  const swallowKeyEvent = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
  };

  const isSafeToTriggerDictation = () => {
    const active = document.activeElement;
    const composerInput = findComposerInput();
    if (!composerInput || !isElementVisible(composerInput)) return false;

    if (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLElement && active.isContentEditable)
    ) {
      if (active === composerInput) return true;
      if (composerInput instanceof HTMLElement && composerInput.contains(active)) return true;
      return false;
    }

    return true;
  };

  const isVoiceModeButton = (btn: HTMLElement | null) => {
    if (!btn) return false;
    const dt = norm(btn.getAttribute("data-testid"));
    const aria = norm(btn.getAttribute("aria-label"));
    if (dt === "composer-speech-button") return true;
    if (aria.includes("voice mode")) return true;
    return false;
  };

  const isDictationButtonVisible = (btn: HTMLElement | null) => {
    if (!btn) return false;
    if (btn.offsetParent === null) return false;
    return isElementVisible(btn);
  };

  const findDictationButtonsIn = (root: Document | Element) => {
    const found: HTMLElement[] = [];
    const direct = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button[aria-label="Dictate button"], [role="button"][aria-label="Dictate button"]'
      )
    );
    for (const btn of direct) {
      if (isDictationButtonVisible(btn) && !isVoiceModeButton(btn)) {
        found.push(btn);
      }
    }

    const fallbackSelectors = [
      '[role="button"][aria-label*="dictat" i]',
      '[role="button"][aria-label*="dictation" i]',
      '[role="button"][aria-label*="диктов" i]',
      '[role="button"][aria-label*="microphone" i]',
      '[role="button"][aria-label*="голос" i]',
      '[role="button"][aria-label*="voice" i]',
      'button[aria-label*="dictat" i]',
      'button[aria-label*="dictation" i]',
      'button[aria-label*="диктов" i]',
      'button[aria-label*="microphone" i]',
      'button[aria-label*="голос" i]',
      'button[aria-label*="voice" i]'
    ];

    const candidates = Array.from(root.querySelectorAll<HTMLElement>(fallbackSelectors.join(",")));
    for (const btn of candidates) {
      if (found.includes(btn)) continue;
      if (isVoiceModeButton(btn)) continue;
      if (isDictationButtonVisible(btn)) found.push(btn);
    }

    return found;
  };

  const findDictationButtonIn = (root: Document | Element) => {
    const direct = root.querySelector<HTMLElement>(
      'button[aria-label="Dictate button"], [role="button"][aria-label="Dictate button"]'
    );
    if (direct && isDictationButtonVisible(direct) && !isVoiceModeButton(direct)) return direct;

    const fallbackSelectors = [
      '[role="button"][aria-label*="dictat" i]',
      '[role="button"][aria-label*="dictation" i]',
      '[role="button"][aria-label*="диктов" i]',
      '[role="button"][aria-label*="microphone" i]',
      '[role="button"][aria-label*="голос" i]',
      '[role="button"][aria-label*="voice" i]',
      'button[aria-label*="dictat" i]',
      'button[aria-label*="dictation" i]',
      'button[aria-label*="диктов" i]',
      'button[aria-label*="microphone" i]',
      'button[aria-label*="голос" i]',
      'button[aria-label*="voice" i]'
    ];

    const candidates = Array.from(root.querySelectorAll<HTMLElement>(fallbackSelectors.join(",")));
    for (const btn of candidates) {
      if (isVoiceModeButton(btn)) continue;
      if (isDictationButtonVisible(btn)) return btn;
    }

    return null;
  };

  const isDictationToggleButton = (btn: HTMLElement) => {
    if (isVoiceModeButton(btn)) return false;
    const aria = norm(btn.getAttribute("aria-label"));
    const title = norm(btn.getAttribute("title"));
    const dt = norm(btn.getAttribute("data-testid"));
    if (aria === "dictate button") return true;
    if (aria.includes("dictat") || aria.includes("диктов")) return true;
    if (aria.includes("microphone") || aria.includes("voice") || aria.includes("голос"))
      return true;
    if (title.includes("dictat") || title.includes("диктов")) return true;
    if (title.includes("microphone") || title.includes("voice") || title.includes("голос"))
      return true;
    if (dt.includes("dictat") || dt.includes("dictation")) return true;
    if (dt.includes("microphone") || dt.includes("voice")) return true;
    return false;
  };

  const hasDictationButtonNearby = (btn: Element) => {
    let p: HTMLElement | null = btn.parentElement;
    for (let i = 0; i < 8 && p; i += 1) {
      const candidates = Array.from(p.querySelectorAll<HTMLElement>("button, [role='button']"));
      if (candidates.some((candidate) => isDictationToggleButton(candidate))) return true;
      p = p.parentElement;
    }
    return false;
  };

  const findDictationActionContainers = () => {
    const buttons = findDictationButtonsIn(document);
    const containers = new Set<HTMLElement>();
    for (const btn of buttons) {
      let p: HTMLElement | null = btn.parentElement;
      for (let i = 0; i < 8 && p; i += 1) {
        const actionButtons = p.querySelectorAll("button, [role='button']");
        if (actionButtons.length >= 2) {
          containers.add(p);
          break;
        }
        p = p.parentElement;
      }
      if (p && !containers.has(p)) {
        containers.add(p);
      }
    }
    return Array.from(containers);
  };

  const isStopDictationButton = (btn: Element | null) => {
    if (!btn) return false;
    const aria = norm(btn.getAttribute("aria-label"));
    const title = norm(btn.getAttribute("title"));
    const dt = norm(btn.getAttribute("data-testid"));
    const text = norm(btn.textContent);
    const hasStop =
      aria.includes("stop") ||
      title.includes("stop") ||
      text.includes("stop") ||
      aria.includes("останов") ||
      title.includes("останов") ||
      text.includes("останов");
    if (!hasStop) return false;
    const hasDictation =
      aria.includes("dictation") ||
      aria.includes("record") ||
      title.includes("dictation") ||
      title.includes("record") ||
      text.includes("dictation") ||
      text.includes("record") ||
      aria.includes("диктов") ||
      title.includes("диктов") ||
      text.includes("диктов") ||
      dt.includes("dictation") ||
      dt.includes("record");
    return hasDictation;
  };

  const findStopDictationButton = (): HTMLElement | null => {
    const containers = findDictationActionContainers();
    const roots: Array<Document | Element> = containers.length > 0 ? containers : [document];
    for (const root of roots) {
      const btns = qsa<HTMLElement>("button, [role='button']", root);
      for (const b of btns) {
        if (!isStopDictationButton(b)) continue;
        if (!isVisible(b)) continue;
        return b;
      }
    }
    return null;
  };

  const findSubmitDictationButton = (): HTMLElement | null => {
    const containers = findDictationActionContainers();
    const roots: Array<Document | Element> = containers.length > 0 ? containers : [document];
    for (const root of roots) {
      const btns = qsa<HTMLElement>("button, [role='button']", root);
      for (const b of btns) {
        if (!(b instanceof HTMLElement)) continue;
        if (b instanceof HTMLButtonElement) {
          const type = norm(b.getAttribute("type"));
          if (type === "submit") continue;
        }
        if (b === findSendButton()) continue;
        if (!isSubmitDictationButton(b)) continue;
        if (isSendButton(b)) continue;
        if (!isVisible(b)) continue;
        return b;
      }
    }
    return null;
  };

  const getDictationUiState = (): DictationUiState => {
    if (findStopDictationButton()) return "STOP";
    if (findSubmitDictationButton()) return "SUBMIT";
    return "NONE";
  };

  const findDictationButton = () => {
    const direct = findDictationButtonIn(document);
    if (direct) return direct;

    const footer = document.querySelector('[data-testid="composer-footer-actions"]');
    if (!footer) return null;
    return findDictationButtonIn(footer);
  };

  const waitForDictationButton = (timeoutMs = 1500) =>
    new Promise<HTMLElement | null>((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        const btn = findDictationButton();
        if (btn) {
          resolve(btn);
          return;
        }
        if (performance.now() - t0 > timeoutMs) {
          resolve(null);
          return;
        }
        setTimeout(tick, 60);
      };
      tick();
    });

  const triggerDictationToggle = async () => {
    const btn = await waitForDictationButton(1500);
    if (!btn) {
      tmLog("dictation button not found");
      return false;
    }
    tmLog("dictation button found", { btn: describeEl(btn) });
    btn.click();
    lastDictationToggleAt = performance.now();
    tmLog("dictation button clicked", { btn: describeEl(btn) });
    return true;
  };

  const ensureNotGenerating = (timeoutMs: number) =>
    new Promise<boolean>((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        if (!findStopGeneratingButton()) {
          resolve(true);
          return;
        }
        if (performance.now() - t0 > timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(tick, 120);
      };
      tick();
    });

  const stopGeneratingIfPossible = async (timeoutMs: number) => {
    const stopBtn = findStopGeneratingButton();
    if (!stopBtn) return true;

    tmLog("stop generating before send", { btn: describeEl(stopBtn) });
    ctx.helpers.humanClick(stopBtn, "stop generating");

    const ok = await ensureNotGenerating(timeoutMs);
    if (!ok) {
      tmLog("stop generating timeout");
    }
    return ok;
  };

  const waitForFinalText = ({ snapshot, timeoutMs, quietMs }: WaitForFinalTextArgs) =>
    new Promise<WaitForFinalTextResult>((resolve) => {
      const t0 = performance.now();

      const first = readInputText();
      let lastText = first.text;
      let lastChangeAt = performance.now();

      tmLog("waitForFinalText start", {
        timeoutMs,
        quietMs,
        inputFound: first.ok,
        inputKind: first.kind,
        snapshotLen: (snapshot || "").length,
        len: lastText.length,
        preview: lastText,
        snapshot: snapshot || ""
      });

      const tick = () => {
        const cur = readInputText();
        const v = cur.text;

        if (v !== lastText) {
          lastText = v;
          lastChangeAt = performance.now();
          tmLog("input changed", {
            inputFound: cur.ok,
            inputKind: cur.kind,
            len: v.length,
            preview: v
          });
        }

        const stableForMs = (performance.now() - lastChangeAt) | 0;

        const hasText = v.trim().length > 0;

        if (hasText && stableForMs >= quietMs) {
          tmLog("final text stable", {
            stableForMs,
            changed: true,
            finalLen: v.length,
            inputFound: cur.ok,
            inputKind: cur.kind
          });
          resolve({ ok: true, text: v, kind: cur.kind, inputOk: cur.ok });
          return;
        }

        if (performance.now() - t0 > timeoutMs) {
          tmLog("final text timeout", {
            changed: v.trim().length > 0,
            snapshotLen: (snapshot || "").length,
            finalLen: v.length,
            inputFound: cur.ok,
            inputKind: cur.kind,
            preview: v
          });
          resolve({ ok: false, text: v, kind: cur.kind, inputOk: cur.ok });
          return;
        }

        setTimeout(tick, 60);
      };

      tick();
    });

  const clickSendWithAck = async () => {
    const before = readInputText().text;

    const btn = findSendButton();
    if (!btn) {
      tmLog("send button not found");
      return false;
    }
    if (isDisabled(btn)) {
      tmLog("send button disabled", { btn: describeEl(btn) });
      return false;
    }

    ctx.helpers.humanClick(btn, "send");

    const t0 = performance.now();
    while (performance.now() - t0 <= cfg.sendAckTimeoutMs) {
      const cur = readInputText().text;
      const cleared = cur.trim().length === 0;
      const stopGen = findStopGeneratingButton();
      const ack = cleared || !!stopGen;

      if (ack) {
        tmLog("ack ok", {
          ok: true,
          changed: cur !== before,
          len: cur.length,
          preview: cur
        });
        return true;
      }

      await new Promise((r) => setTimeout(r, 120));
    }

    const cur = readInputText().text;
    tmLog("ack timeout", {
      ok: false,
      changed: cur !== before,
      len: cur.length,
      preview: cur
    });
    return false;
  };

  const runAutoSendFlow = async (
    trigger: string,
    snapshotOverride?: string,
    initialShiftHeld = false
  ) => {
    if (inFlight) {
      tmLog("skip: inFlight already true", { reason: trigger });
      return;
    }
    inFlight = true;
    let cancelByShift = initialShiftHeld;
    const handleShiftKey = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        cancelByShift = true;
        tmLog("shift cancel received", { reason: trigger });
      }
    };
    window.addEventListener("keydown", handleShiftKey, true);

    try {
      if (!cfg.autoSendEnabled) {
        tmLog("auto-send disabled", { reason: trigger });
        return;
      }

      const snap = readInputText();
      const snapshot = snapshotOverride ?? snap.text;

      tmLog("auto-send flow start", {
        reason: trigger,
        inputFound: snap.ok,
        inputKind: snap.kind,
        snapshotLen: snapshot.length,
        snapshot,
        initialShiftHeld
      });

      const finalRes = await waitForFinalText({
        snapshot,
        timeoutMs: cfg.finalTextTimeoutMs,
        quietMs: cfg.finalTextQuietMs
      });

      if (!finalRes.ok) {
        tmLog("no stable final text, abort", { reason: trigger });
        return;
      }

      if ((finalRes.text || "").trim().length === 0) {
        tmLog("final text empty, abort", { reason: trigger });
        return;
      }

      if (cancelByShift) {
        tmLog("send skipped by shift", { reason: trigger });
        return;
      }

      const okGen = await stopGeneratingIfPossible(20000);
      if (!okGen) {
        tmLog("abort: still generating", { reason: trigger });
        return;
      }

      if (cancelByShift) {
        tmLog("send skipped by shift", { reason: trigger });
        return;
      }

      const ok1 = await clickSendWithAck();
      tmLog("send result", { ok: ok1, reason: trigger });
    } catch (e) {
      tmLog("flow exception", {
        reason: trigger,
        preview: String((e && (e as Error).stack) || (e as Error).message || e)
      });
    } finally {
      window.removeEventListener("keydown", handleShiftKey, true);
      inFlight = false;
      tmLog("auto-send flow end", { reason: trigger });
    }
  };

  const injectPageTranscribeHook = () => {
    const runtime =
      (
        globalThis as typeof globalThis & {
          chrome?: { runtime?: { getURL?: (p: string) => string } };
        }
      ).chrome?.runtime ??
      (
        globalThis as typeof globalThis & {
          browser?: { runtime?: { getURL?: (p: string) => string } };
        }
      ).browser?.runtime;

    if (!runtime?.getURL) {
      tmLog("runtime.getURL not available");
      return;
    }

    const script = document.createElement("script");
    script.setAttribute("data-tm-transcribe-hook", "1");
    script.dataset.source = TRANSCRIBE_HOOK_SOURCE;
    script.src = runtime.getURL("pageTranscribeHook.js");
    script.onload = () => script.remove();
    document.documentElement.appendChild(script);
  };

  const installTranscribeHook = () => {
    if (transcribeHookInstalled) return;
    transcribeHookInstalled = true;

    injectPageTranscribeHook();

    window.addEventListener("message", handleTranscribeMessage);
  };

  const handleTranscribeMessage = (event: MessageEvent) => {
    if (event.source !== window) return;
    const raw = event.data as unknown;
    if (!raw || typeof raw !== "object") return;
    const data = raw as { source?: string; type?: string; id?: string };
    if (data.source !== TRANSCRIBE_HOOK_SOURCE) return;
    if (!data.type || !data.id) return;

    if (data.type === "start") return;
    if (data.type === "complete") {
      lastTranscribeCompleteAt = performance.now();
      lastTranscriptId = data.id;
      tmLog("transcribe complete", {
        reason: "transcribe",
        transcriptId: data.id,
        completeAt: lastTranscribeCompleteAt
      });
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!cfg.autoSendEnabled && !ctx.settings.startDictation) {
      return;
    }

    const submitDictationVisible = getDictationUiState() === "SUBMIT";

    if (e.key === "Shift" && submitDictationVisible) {
      lastShiftCancelAt = performance.now();
      tmLog("shift cancel recorded", { reason: "shift" });
    }

    // Пока видна галочка "принять диктовку", пробел не должен ничего нажимать
    if (e.code === "Space" && !e.ctrlKey && !e.metaKey && submitDictationVisible) {
      swallowKeyEvent(e);
      return;
    }

    // Пока видна галочка "принять диктовку", Ctrl+Enter должен принять диктовку и отправить сообщение
    if (submitDictationVisible && (e.ctrlKey || e.metaKey) && e.key === "Enter") {
      swallowKeyEvent(e);

      const submitBtn = findSubmitDictationButton();
      if (submitBtn) {
        tmLog("ctrl-enter: submit dictation", { btn: describeEl(submitBtn) });
        ctx.helpers.humanClick(submitBtn, "submit-dictation");
      } else {
        tmLog("ctrl-enter: submit button not found", { reason: "ctrl-enter" });
      }
      return;
    }

    if (isDictationHotkey(e)) {
      tmLog("dictation hotkey received");
      if (!ctx.settings.startDictation) return;
      if (!isSafeToTriggerDictation()) {
        tmLog("dictation blocked by focus");
        return;
      }

      swallowKeyEvent(e);

      if (e.repeat) {
        tmLog("dictation hotkey repeat ignored");
        return;
      }
      if (performance.now() - lastDictationToggleAt < DICTATION_COOLDOWN_MS) {
        tmLog("dictation cooldown active");
        return;
      }

      // Если сейчас открыт UI подтверждения диктовки, Ctrl+Space завершает диктовку через галочку
      const submitBtn = findSubmitDictationButton();
      if (submitBtn) {
        tmLog("dictation submit via hotkey", { btn: describeEl(submitBtn) });
        ctx.helpers.humanClick(submitBtn, "submit dictation via hotkey");
        return;
      }

      // Иначе Ctrl+Space стартует диктовку
      void triggerDictationToggle();
    }
  };

  const handleClick = (e: MouseEvent) => {
    const target = e.target;
    const btn =
      target instanceof Element && target.closest
        ? target.closest("button, [role='button']")
        : null;
    if (!btn) return;

    const btnDesc = describeEl(btn);

    if (isInterestingButton(btn)) {
      const cur = readInputText();
      tmLog("button click", {
        btn: btnDesc,
        inputFound: cur.ok,
        inputKind: cur.kind,
        len: cur.text.length,
        preview: cur.text
      });
    }

    if (
      btn instanceof HTMLElement &&
      !isSubmitDictationButton(btn) &&
      isDictationButtonVisible(btn) &&
      isDictationToggleButton(btn)
    ) {
      lastDictationToggleAt = performance.now();
    }

    if (btn instanceof HTMLElement && isSubmitDictationButton(btn)) {
      lastSubmitSeenAt = performance.now();
      tmLog("submit dictation click observed", { btn: btnDesc, reason: "click" });
    }
  };

  applySettings();

  window.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("click", handleClick, true);

  installTranscribeHook();

  const findComposerFooter = () =>
    document.querySelector<HTMLElement>('[data-testid="composer-footer-actions"]');

  const observeComposerFooter = () => {
    const footer = findComposerFooter();
    if (!footer) {
      tmLog("composer footer not found", { reason: "observe" });
      return;
    }
    if (composerFooterObserver && composerFooterNode === footer) return;
    composerFooterObserver?.disconnect();
    composerFooterNode = footer;
    composerFooterObserver = new MutationObserver(() => {
      handleStateObservation("mutation");
    });
    composerFooterObserver.observe(footer, {
      childList: true,
      subtree: true,
      attributes: true
    });
    handleStateObservation("observer-init");
  };

  const ensureComposerFooterObserver = () => {
    const footer = findComposerFooter();
    if (footer && footer !== composerFooterNode) {
      observeComposerFooter();
    }
  };

  function handleStateObservation(reason: string) {
    const now = performance.now();
    const state = getDictationUiState();
    if (state === "SUBMIT") {
      lastSubmitSeenAt = now;
    }
    tmLog("state observed", {
      state,
      reason,
      lastSubmitSeenAt,
      lastStateChangedAt
    });

    if (state === lastState) return;

    const prevState = lastState;
    const prevChangedAt = lastStateChangedAt;
    lastState = state;
    lastStateChangedAt = now;

    if (state === "SUBMIT") {
      lastShiftCancelAt = 0;
    }

    tmLog("state transition", {
      state,
      from: prevState,
      to: state,
      reason,
      lastSubmitSeenAt
    });

    if (prevState === "SUBMIT" && state === "NONE") {
      const elapsedSinceAutoSend = now - lastAutoSendTriggeredAt;
      const cancelByShift = lastShiftCancelAt >= prevChangedAt;
      const input = readInputText();
      const hasText = input.text.trim().length > 0;

      if (!cfg.autoSendEnabled) {
        tmLog("auto-send skipped: disabled", { reason });
        return;
      }
      if (!hasText) {
        tmLog("auto-send skipped: empty input", { reason });
        return;
      }
      if (cancelByShift) {
        tmLog("auto-send skipped: shift cancel", { reason });
        return;
      }
      if (elapsedSinceAutoSend < AUTO_SEND_COOLDOWN_MS) {
        tmLog("auto-send skipped: cooldown", {
          reason,
          elapsedMs: Math.round(elapsedSinceAutoSend)
        });
        return;
      }

      if (isCodexPath(location.pathname) && !cfg.allowAutoSendInCodex) {
        tmLog("auto-send skipped on Codex path", { reason });
        return;
      }

      lastAutoSendTriggeredAt = now;
      void runAutoSendFlow("submit->none transition", input.text, ctx.keyState.shift);
    }
  }

  tmLog("dictation auto-send init", { reason: "init", preview: location.href });

  observeComposerFooter();
  composerRootObserver = new MutationObserver(() => {
    ensureComposerFooterObserver();
  });
  composerRootObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  return {
    name: "dictationAutoSend",
    dispose: () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("message", handleTranscribeMessage);
      composerFooterObserver?.disconnect();
      composerRootObserver?.disconnect();
    },
    __test: {
      runAutoSendFlow: (snapshotOverride?: string, initialShiftHeld?: boolean) =>
        runAutoSendFlow("test submit dictation", snapshotOverride, !!initialShiftHeld),
      getDictationUiState: () => getDictationUiState(),
      findSubmitDictationButton: () => findSubmitDictationButton()
    },
    onSettingsChange: () => {
      applySettings();
    },
    getStatus: () => ({
      active: true,
      details: cfg.allowAutoSendInCodex ? "codex" : "chatgpt"
    })
  };
}
