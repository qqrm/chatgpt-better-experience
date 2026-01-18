import { decideAutoSend } from "../application/autoSendUseCases";
import { DictationInputKind } from "../domain/dictation";
import { FeatureContext, FeatureHandle, LogFields } from "../application/featureContext";
import { isElementVisible, isVisible, norm } from "../lib/utils";

interface DictationConfig {
  enabled: boolean;
  holdToSend: boolean;
  modifierKey: string | null;
  modifierGraceMs: number;
  allowAutoSendInCodex: boolean;
  finalTextTimeoutMs: number;
  finalTextQuietMs: number;
  sendAckTimeoutMs: number;
  logClicks: boolean;
  logBlur: boolean;
}

type TranscribeMode = "codex" | "chatgpt";
type DictationToggleSource = "hotkey" | "button" | "unknown";

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

interface WaitForCodexSubmitReadyResult extends WaitForFinalTextResult {
  btn: HTMLButtonElement | null;
}

interface TranscribeFlowArgs {
  mode: TranscribeMode;
  beforeText: string;
  beforeInputOk: boolean;
  source: DictationToggleSource;
}

const TRANSCRIBE_HOOK_SOURCE = "tm-dictation-transcribe";

const DEFAULT_CONFIG: DictationConfig = {
  enabled: true,
  holdToSend: false,
  modifierKey: "Shift",
  modifierGraceMs: 1600,
  allowAutoSendInCodex: false,
  finalTextTimeoutMs: 25000,
  finalTextQuietMs: 320,
  sendAckTimeoutMs: 4500,
  logClicks: true,
  logBlur: false
};
const DICTATION_COOLDOWN_MS = 400;
const DICTATION_SOURCE_WINDOW_MS = 2500;

export function initDictationAutoSendFeature(ctx: FeatureContext): FeatureHandle {
  const cfg: DictationConfig = { ...DEFAULT_CONFIG };

  let inFlight = false;
  let transcribeInFlight = false;
  let lastDictationSubmitClickAt = 0;
  let transcribeHookInstalled = false;
  let graceUntilMs = 0;
  let graceCaptured = false;
  let lastBlurLogAt = 0;
  let lastDictationToggleAt = 0;
  let lastDictationToggleSource: DictationToggleSource = "unknown";
  let lastDictationToggleSourceAt = 0;

  const transcribeSnapshots = new Map<
    string,
    { snapshot: InputReadResult; source: DictationToggleSource }
  >();

  const tmLog = (scope: string, msg: string, fields?: LogFields) => {
    ctx.logger.debug(scope, msg, fields);
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
    cfg.holdToSend = ctx.settings.holdToSend;
    cfg.allowAutoSendInCodex = ctx.settings.allowAutoSendInCodex;
    cfg.modifierKey = ctx.settings.skipKey;
    if (cfg.modifierKey === "None") cfg.modifierKey = null;
  };

  const updateKeyState = (e: KeyboardEvent, state: boolean) => {
    if (e.key === "Shift") ctx.keyState.shift = state;
    if (e.key === "Control" || e.key === "Ctrl") ctx.keyState.ctrl = state;
    if (e.key === "Alt") ctx.keyState.alt = state;
  };

  const keyMatchesModifier = (e: KeyboardEvent | null) => {
    if (!cfg.modifierKey || cfg.modifierKey === "None") return false;
    if (cfg.modifierKey === "Control") return e && (e.key === "Control" || e.key === "Ctrl");
    return e && e.key === cfg.modifierKey;
  };

  const isModifierHeldNow = () => {
    if (!cfg.modifierKey || cfg.modifierKey === "None") return false;
    if (cfg.modifierKey === "Control") return ctx.keyState.ctrl;
    if (cfg.modifierKey === "Alt") return ctx.keyState.alt;
    return ctx.keyState.shift;
  };

  const isModifierHeldFromEvent = (e: MouseEvent | null) => {
    if (!cfg.modifierKey || cfg.modifierKey === "None") return false;
    if (!e) return false;
    if (cfg.modifierKey === "Control") return !!e.ctrlKey;
    if (cfg.modifierKey === "Alt") return !!e.altKey;
    return !!e.shiftKey;
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

  const findSendButton = () =>
    qs<HTMLButtonElement>('[data-testid="send-button"]') ||
    qs<HTMLButtonElement>("#composer-submit-button") ||
    qs<HTMLButtonElement>("button.composer-submit-btn") ||
    qs<HTMLButtonElement>("form button[type='submit']") ||
    qs<HTMLButtonElement>('button[aria-label="Submit"]') ||
    qs<HTMLButtonElement>('button[aria-label*="Send"]') ||
    qs<HTMLButtonElement>('button[aria-label*="Отправ"]') ||
    null;

  const isDisabled = (btn: HTMLButtonElement | null) => {
    if (!btn) return true;
    if (btn.hasAttribute("disabled")) return true;
    const ariaDisabled = btn.getAttribute("aria-disabled");
    if (ariaDisabled && ariaDisabled !== "false") return true;
    return false;
  };

  const isSubmitDictationButton = (btn: HTMLButtonElement | null) => {
    if (!btn) return false;

    const aRaw = btn.getAttribute("aria-label");
    const tRaw = btn.getAttribute("title");
    const dtRaw = btn.getAttribute("data-testid");
    const txtRaw = btn.textContent;

    const a = norm(aRaw);
    const t = norm(tRaw);
    const dt = norm(dtRaw);
    const txt = norm(txtRaw);

    if (a === "submit") {
      if (btn.classList.contains("composer-submit-btn")) return false;
      let p: HTMLElement | null = btn.parentElement;
      for (let i = 0; i < 8 && p; i += 1) {
        const hasDictateButton = !!p.querySelector('button[aria-label="Dictate button"]');
        if (hasDictateButton) return true;
        p = p.parentElement;
      }
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

  const isInterestingButton = (btn: HTMLButtonElement | null) => {
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
    const candidates = qsa<HTMLButtonElement>("button").filter((b) => {
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

  const isComposerFocused = () => {
    const textbox = findTextbox();
    if (!textbox) return false;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return false;
    return active === textbox || textbox.contains(active);
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

  const isVoiceModeButton = (btn: HTMLButtonElement | null) => {
    if (!btn) return false;
    const dt = norm(btn.getAttribute("data-testid"));
    const aria = norm(btn.getAttribute("aria-label"));
    if (dt === "composer-speech-button") return true;
    if (aria.includes("voice mode")) return true;
    return false;
  };

  const isDictationButtonVisible = (btn: HTMLButtonElement | null) => {
    if (!btn) return false;
    if (btn.offsetParent === null) return false;
    return isElementVisible(btn);
  };

  const findDictationButtonIn = (root: Document | Element) => {
    const direct = root.querySelector<HTMLButtonElement>('button[aria-label="Dictate button"]');
    if (direct && isDictationButtonVisible(direct) && !isVoiceModeButton(direct)) return direct;

    const fallbackSelectors = [
      'button[aria-label*="dictat" i]',
      'button[aria-label*="dictation" i]',
      'button[aria-label*="диктов" i]',
      'button[aria-label*="microphone" i]',
      'button[aria-label*="голос" i]',
      'button[aria-label*="voice" i]'
    ];

    const candidates = Array.from(
      root.querySelectorAll<HTMLButtonElement>(fallbackSelectors.join(","))
    );
    for (const btn of candidates) {
      if (isVoiceModeButton(btn)) continue;
      if (isDictationButtonVisible(btn)) return btn;
    }

    return null;
  };

  const isDictationToggleButton = (btn: HTMLButtonElement) => {
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

  const findDictationButton = () => {
    const direct = findDictationButtonIn(document);
    if (direct) return direct;

    const footer = document.querySelector('[data-testid="composer-footer-actions"]');
    if (!footer) return null;
    return findDictationButtonIn(footer);
  };

  const waitForDictationButton = (timeoutMs = 1500) =>
    new Promise<HTMLButtonElement | null>((resolve) => {
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
      tmLog("KEY", "dictation button not found");
      return false;
    }
    tmLog("KEY", "dictation button found");
    lastDictationToggleSource = "hotkey";
    lastDictationToggleSourceAt = performance.now();
    btn.click();
    lastDictationToggleAt = lastDictationToggleSourceAt;
    tmLog("KEY", "dictation button clicked");
    return true;
  };

  const isNonSkipModifierHeld = () => {
    const allowShift = cfg.modifierKey === "Shift";
    const allowCtrl = cfg.modifierKey === "Control";
    const allowAlt = cfg.modifierKey === "Alt";
    if (ctx.keyState.shift && !allowShift) return true;
    if (ctx.keyState.ctrl && !allowCtrl) return true;
    if (ctx.keyState.alt && !allowAlt) return true;
    return false;
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

    tmLog("SEND", "stop generating before send", { btn: describeEl(stopBtn) });
    ctx.helpers.humanClick(stopBtn, "stop generating");

    const ok = await ensureNotGenerating(timeoutMs);
    if (!ok) {
      tmLog("SEND", "stop generating timeout");
    }
    return ok;
  };

  const isAttachmentButton = (btn: HTMLButtonElement) => {
    const aria = norm(btn.getAttribute("aria-label"));
    const title = norm(btn.getAttribute("title"));
    const dt = norm(btn.getAttribute("data-testid"));
    const txt = norm(btn.textContent);
    const hay = `${aria} ${title} ${dt} ${txt}`;
    if (hay.includes("add file")) return true;
    if (hay.includes("attach")) return true;
    if (hay.includes("attachment")) return true;
    if (hay.includes("upload")) return true;
    if (hay.includes("plus")) return true;
    if (hay.includes("clip")) return true;
    if (hay.includes("файл")) return true;
    if (hay.includes("влож")) return true;
    return false;
  };

  const findCodexSubmitButton = () => {
    const textbox = findTextbox();
    const formFromTextbox = textbox?.closest("form");
    const form =
      qs<HTMLFormElement>('form[aria-label="Codex composer"]') ||
      qs<HTMLFormElement>('form[data-testid*="codex" i]') ||
      formFromTextbox;
    if (!form) return null;
    const codexSubmit = form.querySelector<HTMLButtonElement>(
      "button.composer-submit-btn, button[aria-label='Submit']"
    );
    if (codexSubmit) return codexSubmit;
    const sendBtn = findSendButton();
    if (sendBtn && form.contains(sendBtn)) return sendBtn;
    const buttons = Array.from(form.querySelectorAll("button")).filter(
      (btn): btn is HTMLButtonElement => btn instanceof HTMLButtonElement
    );
    const candidates = buttons.filter((btn) => {
      if (!isElementVisible(btn)) return false;
      if (isSubmitDictationButton(btn)) return false;
      if (isAttachmentButton(btn)) return false;
      return true;
    });
    const preferred = candidates.find((btn) => {
      const aria = norm(btn.getAttribute("aria-label"));
      const title = norm(btn.getAttribute("title"));
      const dt = norm(btn.getAttribute("data-testid"));
      if (aria.includes("submit") || aria.includes("send")) return true;
      if (title.includes("submit") || title.includes("send")) return true;
      if (dt.includes("submit") || dt.includes("send")) return true;
      if (btn.getAttribute("type") === "submit") return true;
      return false;
    });
    return preferred ?? candidates[candidates.length - 1] ?? null;
  };

  const waitForFinalText = ({ snapshot, timeoutMs, quietMs }: WaitForFinalTextArgs) =>
    new Promise<WaitForFinalTextResult>((resolve) => {
      const t0 = performance.now();

      const first = readInputText();
      let lastText = first.text;
      let lastChangeAt = performance.now();

      tmLog("WAIT", "waitForFinalText start", {
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
          tmLog("WAIT", "input changed", {
            inputFound: cur.ok,
            inputKind: cur.kind,
            len: v.length,
            preview: v
          });
        }

        const stableForMs = (performance.now() - lastChangeAt) | 0;

        const changed = snapshot && snapshot.length > 0 ? v !== snapshot : v.trim().length > 0;

        if (changed && stableForMs >= quietMs) {
          tmLog("WAIT", "final text stable", {
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
          tmLog("WAIT", "final text timeout", {
            changed: snapshot && snapshot.length > 0 ? v !== snapshot : v.trim().length > 0,
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

  const waitForCodexSubmitReady = ({ snapshot, timeoutMs, quietMs }: WaitForFinalTextArgs) =>
    new Promise<WaitForCodexSubmitReadyResult>((resolve) => {
      const t0 = performance.now();

      const first = readInputText();
      let lastText = first.text;
      let lastChangeAt = performance.now();
      let seenNonEmpty = (first.text || "").trim().length > 0;
      let stableTextReady = false;

      tmLog("WAIT", "waitForCodexSubmitReady start", {
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
          tmLog("WAIT", "codex input changed", {
            inputFound: cur.ok,
            inputKind: cur.kind,
            len: v.length,
            preview: v
          });
        }

        if ((v || "").trim().length > 0) seenNonEmpty = true;

        const stableForMs = (performance.now() - lastChangeAt) | 0;
        const changed = snapshot && snapshot.length > 0 ? v !== snapshot : v.trim().length > 0;

        if (!stableTextReady && changed && stableForMs >= quietMs && v.trim().length > 0) {
          stableTextReady = true;
          tmLog("WAIT", "codex text stable", {
            stableForMs,
            changed: true,
            finalLen: v.length,
            inputFound: cur.ok,
            inputKind: cur.kind
          });
        }

        const btn = findCodexSubmitButton();
        const btnReady = !!btn && !isDisabled(btn) && isElementVisible(btn);

        if (btnReady) {
          const allowReady =
            stableTextReady ||
            (seenNonEmpty && stableForMs >= quietMs) ||
            (!cur.ok && seenNonEmpty);
          if (allowReady) {
            resolve({ ok: true, text: v, kind: cur.kind, inputOk: cur.ok, btn });
            return;
          }
        }

        if (performance.now() - t0 > timeoutMs) {
          tmLog("WAIT", "codex submit timeout", {
            changed,
            snapshotLen: (snapshot || "").length,
            finalLen: v.length,
            inputFound: cur.ok,
            inputKind: cur.kind,
            preview: v
          });
          resolve({ ok: false, text: v, kind: cur.kind, inputOk: cur.ok, btn });
          return;
        }

        setTimeout(tick, 80);
      };

      tick();
    });

  const waitForAvailableButton = async (
    finder: () => HTMLButtonElement | null,
    timeoutMs: number,
    reason: string
  ) => {
    const t0 = performance.now();
    while (performance.now() - t0 <= timeoutMs) {
      const btn = finder();
      if (btn && !isDisabled(btn) && isElementVisible(btn)) return btn;
      await new Promise((r) => setTimeout(r, 80));
    }
    tmLog("WAIT", `${reason} button timeout`, { timeoutMs });
    return null;
  };

  const clickSendWithAck = async () => {
    const before = readInputText().text;

    const btn = findSendButton();
    if (!btn) {
      tmLog("SEND", "send button not found");
      return false;
    }
    if (isDisabled(btn)) {
      tmLog("SEND", "send button disabled", { btn: describeEl(btn) });
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
        tmLog("SEND", "ack ok", {
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
    tmLog("SEND", "ack timeout", {
      ok: false,
      changed: cur !== before,
      len: cur.length,
      preview: cur
    });
    return false;
  };

  const runFlowAfterSubmitClick = async (submitBtnDesc: string, clickHeld: boolean) => {
    if (inFlight) {
      tmLog("FLOW", "skip: inFlight already true");
      return;
    }
    inFlight = true;
    lastDictationSubmitClickAt = performance.now();

    try {
      const snap = readInputText();
      const snapshot = snap.text;

      graceUntilMs = performance.now() + cfg.modifierGraceMs;
      graceCaptured = false;
      const initialHeld = isModifierHeldNow();

      tmLog("FLOW", "submit click flow start", {
        btn: submitBtnDesc,
        inputFound: snap.ok,
        inputKind: snap.kind,
        snapshotLen: snapshot.length,
        snapshot,
        graceMs: cfg.modifierGraceMs
      });

      const finalRes = await waitForFinalText({
        snapshot,
        timeoutMs: cfg.finalTextTimeoutMs,
        quietMs: cfg.finalTextQuietMs
      });

      const heldDuring = initialHeld || graceCaptured || isModifierHeldNow() || clickHeld;

      const decision = decideAutoSend({ holdToSend: cfg.holdToSend, heldDuring });

      tmLog("FLOW", "decision", {
        heldDuring: decision.heldDuring,
        holdToSend: decision.holdToSend,
        shouldSend: decision.shouldSend
      });

      if (!finalRes.ok) {
        tmLog("FLOW", "no stable final text, abort");
        return;
      }

      if ((finalRes.text || "").trim().length === 0) {
        tmLog("FLOW", "final text empty, abort");
        return;
      }

      if (!decision.shouldSend) {
        tmLog("FLOW", "send skipped by modifier");
        return;
      }

      const okGen = await stopGeneratingIfPossible(20000);
      if (!okGen) {
        tmLog("FLOW", "abort: still generating");
        return;
      }

      const ok1 = await clickSendWithAck();
      tmLog("FLOW", "send result", { ok: ok1 });

      if (!ok1) {
        const ok2 = await clickSendWithAck();
        tmLog("FLOW", "send retry result", { ok: ok2 });
      }
    } catch (e) {
      tmLog("ERR", "flow exception", {
        preview: String((e && (e as Error).stack) || (e as Error).message || e)
      });
    } finally {
      inFlight = false;
      tmLog("FLOW", "submit click flow end");
    }
  };

  const runFlowAfterTranscribe = async ({
    mode,
    beforeText,
    beforeInputOk,
    source
  }: TranscribeFlowArgs) => {
    if (inFlight) {
      tmLog("TRANSCRIBE", "skip: submit flow in progress");
      return;
    }
    if (transcribeInFlight) {
      tmLog("TRANSCRIBE", "skip: inFlight already true");
      return;
    }
    transcribeInFlight = true;

    try {
      if (!cfg.enabled) {
        tmLog("TRANSCRIBE", "auto-send disabled");
        return;
      }

      if (source === "hotkey") {
        tmLog("TRANSCRIBE", "skip: dictation triggered by hotkey");
        return;
      }

      const heldDuring = isModifierHeldNow();
      const decision = decideAutoSend({ holdToSend: cfg.holdToSend, heldDuring });

      if (mode === "codex") {
        if (!cfg.allowAutoSendInCodex) {
          tmLog("CODEX", "auto-send disabled by settings");
          return;
        }

        if (!decision.shouldSend) {
          tmLog("CODEX", "send skipped by modifier", {
            heldDuring: decision.heldDuring,
            holdToSend: decision.holdToSend,
            shouldSend: decision.shouldSend
          });
          return;
        }

        const submitRes = await waitForCodexSubmitReady({
          snapshot: beforeText,
          timeoutMs: cfg.finalTextTimeoutMs,
          quietMs: cfg.finalTextQuietMs
        });

        if (!submitRes.ok || !submitRes.btn) {
          tmLog("CODEX", "submit not ready");
          return;
        }

        ctx.helpers.humanClick(submitRes.btn, "codex submit");
        tmLog("CODEX", "submit clicked");
        return;
      }

      if (findStopGeneratingButton()) {
        tmLog("TRANSCRIBE", "skip: generation in progress");
        return;
      }

      if (performance.now() - lastDictationSubmitClickAt < cfg.finalTextTimeoutMs) {
        tmLog("TRANSCRIBE", "skip: dictation submit click observed");
        return;
      }

      if (isNonSkipModifierHeld()) {
        tmLog("TRANSCRIBE", "skip: modifier held");
        return;
      }

      if (!isComposerFocused()) {
        tmLog("TRANSCRIBE", "skip: composer not focused");
        return;
      }

      if ((beforeText || "").trim().length > 0) {
        tmLog("TRANSCRIBE", "skip: input not empty before dictation");
        return;
      }

      if (!beforeInputOk) {
        tmLog("TRANSCRIBE", "skip: input not found before dictation");
        return;
      }

      const finalRes = await waitForFinalText({
        snapshot: beforeText,
        timeoutMs: cfg.finalTextTimeoutMs,
        quietMs: cfg.finalTextQuietMs
      });

      if (!finalRes.ok) {
        tmLog("TRANSCRIBE", "final text timeout");
        return;
      }

      if ((finalRes.text || "").trim().length === 0) {
        tmLog("TRANSCRIBE", "final text empty");
        return;
      }

      if (!decision.shouldSend) {
        tmLog("TRANSCRIBE", "send skipped by modifier", {
          heldDuring: decision.heldDuring,
          holdToSend: decision.holdToSend,
          shouldSend: decision.shouldSend
        });
        return;
      }

      const btn = await waitForAvailableButton(findSendButton, 2500, "send");
      if (!btn) {
        tmLog("TRANSCRIBE", "send button not found");
        return;
      }

      const ok = await clickSendWithAck();
      tmLog("TRANSCRIBE", "send result", { ok });
    } catch (e) {
      tmLog("ERR", "transcribe flow exception", {
        preview: String((e && (e as Error).stack) || (e as Error).message || e)
      });
    } finally {
      transcribeInFlight = false;
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
      tmLog("TRANSCRIBE", "runtime.getURL not available");
      return;
    }

    const script = document.createElement("script");
    script.setAttribute("data-tm-transcribe-hook", "1");
    script.dataset.source = TRANSCRIBE_HOOK_SOURCE;
    script.src = runtime.getURL("pageTranscribeHook.js");
    script.onload = () => script.remove();
    document.documentElement.appendChild(script);
  };

  let transcribeMode: TranscribeMode = "chatgpt";

  const installTranscribeHook = ({ mode }: { mode: TranscribeMode }) => {
    if (transcribeHookInstalled) return;
    transcribeHookInstalled = true;
    transcribeMode = mode;

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

    if (data.type === "start") {
      const snapshot = readInputText();
      const age = performance.now() - lastDictationToggleSourceAt;
      const source = age <= DICTATION_SOURCE_WINDOW_MS ? lastDictationToggleSource : "unknown";
      transcribeSnapshots.set(data.id, { snapshot, source });
      return;
    }

    if (data.type === "complete") {
      const captured = transcribeSnapshots.get(data.id);
      if (captured) transcribeSnapshots.delete(data.id);
      void runFlowAfterTranscribe({
        mode: transcribeMode,
        beforeText: captured?.snapshot.text ?? "",
        beforeInputOk: captured?.snapshot.ok ?? false,
        source: captured?.source ?? "unknown"
      });
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    updateKeyState(e, true);
    if (keyMatchesModifier(e)) {
      const graceActive = performance.now() <= graceUntilMs;
      if (graceActive) graceCaptured = true;
      tmLog("KEY", "down modifier", { graceActive, graceMs: cfg.modifierGraceMs });
    }

    if (isDictationHotkey(e)) {
      tmLog("KEY", "dictation hotkey received");
      if (!ctx.settings.startDictation) return;
      if (!isSafeToTriggerDictation()) {
        tmLog("KEY", "dictation blocked by focus");
        return;
      }
      swallowKeyEvent(e);
      if (e.repeat) {
        tmLog("KEY", "dictation hotkey repeat ignored");
        return;
      }
      if (performance.now() - lastDictationToggleAt < DICTATION_COOLDOWN_MS) {
        tmLog("KEY", "dictation cooldown active");
        return;
      }
      void triggerDictationToggle();
    }
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    updateKeyState(e, false);
    if (keyMatchesModifier(e)) {
      tmLog("KEY", "up modifier");
    }
  };

  const handleBlur = () => {
    ctx.keyState.shift = false;
    ctx.keyState.ctrl = false;
    ctx.keyState.alt = false;
    if (!cfg.logBlur) return;
    const t = performance.now();
    if (t - lastBlurLogAt > 800) {
      lastBlurLogAt = t;
      tmLog("KEY", "window blur reset modifier");
    }
  };

  const handleClick = (e: MouseEvent) => {
    const target = e.target;
    const btn = target instanceof Element && target.closest ? target.closest("button") : null;
    if (!btn) return;

    const btnDesc = describeEl(btn);

    if (cfg.logClicks && btn instanceof HTMLButtonElement && isInterestingButton(btn)) {
      const cur = readInputText();
      tmLog("CLICK", "button click", {
        btn: btnDesc,
        inputFound: cur.ok,
        inputKind: cur.kind,
        len: cur.text.length,
        preview: cur.text,
        graceActive: performance.now() <= graceUntilMs
      });
    }

    if (
      btn instanceof HTMLButtonElement &&
      !isSubmitDictationButton(btn) &&
      isDictationButtonVisible(btn) &&
      isDictationToggleButton(btn)
    ) {
      lastDictationToggleSource = "button";
      lastDictationToggleSourceAt = performance.now();
      lastDictationToggleAt = lastDictationToggleSourceAt;
    }

    if (cfg.enabled && btn instanceof HTMLButtonElement && isSubmitDictationButton(btn)) {
      void (async () => {
        if (!isCodexPath(location.pathname) || cfg.allowAutoSendInCodex) {
          await runFlowAfterSubmitClick(btnDesc, isModifierHeldFromEvent(e));
        } else {
          tmLog("FLOW", "auto-send skipped on Codex path");
        }
      })();
    }
  };

  applySettings();

  window.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("keyup", handleKeyUp, true);
  window.addEventListener("blur", handleBlur, true);
  document.addEventListener("click", handleClick, true);

  installTranscribeHook({ mode: isCodexPath(location.pathname) ? "codex" : "chatgpt" });

  tmLog("BOOT", "dictation auto-send init", { preview: location.href });

  return {
    name: "dictationAutoSend",
    dispose: () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", handleBlur, true);
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("message", handleTranscribeMessage);
      transcribeSnapshots.clear();
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
