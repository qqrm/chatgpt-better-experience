import { decideAutoSend } from "./autoSendUseCases";
import { shouldTriggerArrowUpEdit } from "./editLastMessageUseCases";
import { updateWideChatStyle } from "./wideChat";
import { DictationConfig, DictationInputKind } from "../domain/dictation";
import { SETTINGS_DEFAULTS } from "../domain/settings";
import { StoragePort } from "../domain/ports/storagePort";
import { isElementVisible, isVisible, norm, normalizeSettings } from "../lib/utils";

declare global {
  interface Window {
    __ChatGPTDictationAutoSendLoaded__?: boolean;
  }
}

export interface ContentScriptDeps {
  storagePort?: StoragePort | null;
}

const fallbackStoragePort: StoragePort = {
  get: (defaults) => Promise.resolve({ ...defaults }),
  set: () => Promise.resolve()
};

export const startContentScript = ({ storagePort }: ContentScriptDeps = {}) => {
  if (window.__ChatGPTDictationAutoSendLoaded__) return;
  window.__ChatGPTDictationAutoSendLoaded__ = true;

  const resolvedStorage = storagePort ?? fallbackStoragePort;

  const DEBUG = false;
  const log = (...args: unknown[]) => {
    if (DEBUG) console.info("[DictationAutoSend]", ...args);
  };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitPresent(sel: string, root: Document | Element = document, timeoutMs = 2500) {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      const el = root.querySelector(sel);
      if (el) return el;
      await sleep(25);
    }
    return null;
  }

  function isMenuVisibleForDelete(menu: Element) {
    if (!menu) return false;
    const rect = menu.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return false;
    if (document.documentElement.getAttribute(ONE_CLICK_DELETE_ROOT_FLAG) === "1") return true;
    return isElementVisible(menu);
  }

  async function waitMenuForOneClickDeleteItem(timeoutMs = 1500) {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      const menus = qsa('[data-radix-menu-content][role="menu"]');
      for (const menu of menus) {
        if (!isMenuVisibleForDelete(menu)) continue;
        const item = menu.querySelector(
          'div[role="menuitem"][data-testid="delete-chat-menu-item"]'
        );
        if (item) return item;
      }
      const fallback = document.querySelector(
        'div[role="menuitem"][data-testid="delete-chat-menu-item"]'
      );
      if (fallback) return fallback;
      await sleep(25);
    }
    return null;
  }

  interface ContentConfig extends DictationConfig {
    allowAutoSendInCodex: boolean;
    editLastMessageOnArrowUp: boolean;
    autoExpandChatsEnabled: boolean;
    autoTempChatEnabled: boolean;
    oneClickDeleteEnabled: boolean;
    wideChatWidth: number;
    logClicks: boolean;
    logBlur: boolean;
  }

  const CFG: ContentConfig = {
    enabled: true,

    holdToSend: false,
    modifierKey: "Shift",
    modifierGraceMs: 1600,
    allowAutoSendInCodex: false,
    editLastMessageOnArrowUp: true,

    autoExpandChatsEnabled: true,
    autoTempChatEnabled: false,
    oneClickDeleteEnabled: false,
    wideChatWidth: 0,

    finalTextTimeoutMs: 25000,
    finalTextQuietMs: 320,

    sendAckTimeoutMs: 4500,

    logClicks: true,
    logBlur: false
  };

  let LOG_N = 0;
  const BOOT_T0 = performance.now();

  function nowMs() {
    return (performance.now() - BOOT_T0) | 0;
  }

  function short(s: string, n = 140) {
    if (s == null) return "";
    const t = String(s).replace(/\s+/g, " ").trim();
    if (t.length <= n) return t;
    return t.slice(0, n) + "...";
  }

  type LogFields = Record<string, unknown> & {
    preview?: string;
    snapshot?: string;
    btn?: string;
  };

  function tmLog(scope: string, msg: string, fields?: LogFields) {
    if (!DEBUG) return;
    LOG_N += 1;
    const t = String(nowMs()).padStart(6, " ");
    let tail = "";
    if (fields && typeof fields === "object") {
      const allow = [
        "heldDuring",
        "holdToSend",
        "shouldSend",
        "ok",
        "changed",
        "timeoutMs",
        "quietMs",
        "stableForMs",
        "len",
        "snapshotLen",
        "finalLen",
        "graceMs",
        "graceActive",
        "inputKind",
        "inputFound"
      ];
      const parts: string[] = [];
      for (const k of allow) {
        if (k in fields) parts.push(`${k}=${String(fields[k])}`);
      }
      if ("preview" in fields) parts.push(`preview="${short(String(fields.preview ?? ""), 120)}"`);
      if ("snapshot" in fields)
        parts.push(`snapshot="${short(String(fields.snapshot ?? ""), 120)}"`);
      if ("btn" in fields) parts.push(`btn="${short(String(fields.btn ?? ""), 160)}"`);
      if (parts.length) tail = " | " + parts.join(" ");
    }
    console.log(`[TM DictationAutoSend] #${LOG_N} ${t} ${scope}: ${msg}${tail}`);
  }

  function qs<T extends Element = Element>(sel: string, root: Document | Element = document) {
    return root.querySelector<T>(sel);
  }

  function qsa<T extends Element = Element>(sel: string, root: Document | Element = document) {
    return Array.from(root.querySelectorAll<T>(sel));
  }

  function describeEl(el: Element | null) {
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
  }

  function humanClick(el: HTMLElement | null, why: string) {
    if (!el) return false;
    try {
      if (typeof el.focus === "function") el.focus();
    } catch (_) {}

    try {
      el.scrollIntoView({ block: "center", inline: "center" });
    } catch (_) {}

    const rect = el.getBoundingClientRect();
    const cx = Math.max(1, Math.floor(rect.left + rect.width / 2));
    const cy = Math.max(1, Math.floor(rect.top + rect.height / 2));
    const common = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: cx,
      clientY: cy,
      button: 0
    };

    try {
      el.dispatchEvent(
        new PointerEvent("pointerdown", {
          ...common,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true
        })
      );
    } catch (_) {}
    try {
      el.dispatchEvent(new MouseEvent("mousedown", common));
    } catch (_) {}
    try {
      el.dispatchEvent(
        new PointerEvent("pointerup", {
          ...common,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true
        })
      );
    } catch (_) {}
    try {
      el.dispatchEvent(new MouseEvent("mouseup", common));
    } catch (_) {}
    try {
      el.dispatchEvent(new MouseEvent("click", common));
    } catch (_) {}

    tmLog("UI", `humanClick ${why}`, { preview: describeEl(el) });
    return true;
  }

  type TextboxElement = HTMLTextAreaElement | HTMLElement;

  function findTextbox(): HTMLElement | null {
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
  }

  function readTextboxText(el: TextboxElement | null) {
    if (!el) return "";
    if (el instanceof HTMLTextAreaElement) return el.value || "";
    return String(el.innerText || el.textContent || "").replace(/\u00A0/g, " ");
  }

  interface InputReadResult {
    ok: boolean;
    kind: DictationInputKind;
    text: string;
  }

  function readInputText(): InputReadResult {
    const el = findTextbox();
    if (!el) return { ok: false, kind: "none", text: "" };
    const kind: DictationInputKind =
      el instanceof HTMLTextAreaElement ? "textarea" : "contenteditable";
    return { ok: true, kind, text: readTextboxText(el) };
  }

  function findSendButton(): HTMLButtonElement | null {
    return (
      qs<HTMLButtonElement>('[data-testid="send-button"]') ||
      qs<HTMLButtonElement>("#composer-submit-button") ||
      qs<HTMLButtonElement>("button.composer-submit-btn") ||
      qs<HTMLButtonElement>("form button[type='submit']") ||
      qs<HTMLButtonElement>('button[aria-label="Submit"]') ||
      qs<HTMLButtonElement>('button[aria-label*="Send"]') ||
      qs<HTMLButtonElement>('button[aria-label*="Отправ"]') ||
      null
    );
  }

  function isDisabled(btn: HTMLButtonElement | null) {
    if (!btn) return true;
    if (btn.hasAttribute("disabled")) return true;
    const ariaDisabled = btn.getAttribute("aria-disabled");
    if (ariaDisabled && ariaDisabled !== "false") return true;
    return false;
  }

  function isSubmitDictationButton(btn: HTMLButtonElement | null) {
    if (!btn) return false;

    const aRaw = btn.getAttribute("aria-label");
    const tRaw = btn.getAttribute("title");
    const dtRaw = btn.getAttribute("data-testid");
    const txtRaw = btn.textContent;

    const a = norm(aRaw);
    const t = norm(tRaw);
    const dt = norm(dtRaw);
    const txt = norm(txtRaw);

    // Codex special case: dictation accept is aria-label="Submit"
    // Guard it so we do not accidentally treat the main send/submit as dictation accept.
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
  }

  function isTextboxTarget(target: EventTarget | null) {
    if (!(target instanceof Node)) return false;
    const textbox = findTextbox();
    if (!textbox) return false;
    return target === textbox || textbox.contains(target);
  }

  function findLastUserMessage() {
    const candidates = qsa<HTMLElement>('[data-message-author-role="user"]');
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const msg = candidates[i];
      if (isElementVisible(msg)) return msg;
    }
    return null;
  }

  function isEditMessageButton(btn: HTMLButtonElement | null) {
    if (!btn) return false;
    const a = norm(btn.getAttribute("aria-label"));
    const t = norm(btn.getAttribute("title"));
    const dt = norm(btn.getAttribute("data-testid"));
    const txt = norm(btn.textContent);
    if (dt.includes("edit")) return true;
    if (a.includes("edit") || a.includes("редакт") || a.includes("измен")) return true;
    if (t.includes("edit") || t.includes("редакт") || t.includes("измен")) return true;
    if (txt.includes("edit") || txt.includes("редакт") || txt.includes("измен")) return true;
    return false;
  }

  function triggerEditLastMessage() {
    const message = findLastUserMessage();
    if (!message) return false;

    const article =
      message.closest("article") ??
      message.closest("[data-message-author-role]") ??
      message.parentElement;

    const searchRoot = article instanceof HTMLElement ? article : message;

    const buttons = qsa<HTMLButtonElement>("button", searchRoot);

    const editBtn =
      buttons.find((btn) => {
        const a = norm(btn.getAttribute("aria-label"));
        if (a.includes("edit message")) return true;
        return isEditMessageButton(btn);
      }) ?? null;

    if (!editBtn) return false;

    return humanClick(editBtn, "edit last message");
  }

  function findStopGeneratingButton() {
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
  }

  function keyMatchesModifier(e: KeyboardEvent | null) {
    if (!CFG.modifierKey || CFG.modifierKey === "None") return false;
    if (CFG.modifierKey === "Control") return e && (e.key === "Control" || e.key === "Ctrl");
    return e && e.key === CFG.modifierKey;
  }

  function isModifierHeldNow() {
    if (!CFG.modifierKey || CFG.modifierKey === "None") return false;
    if (CFG.modifierKey === "Control") return keyState.ctrl;
    if (CFG.modifierKey === "Alt") return keyState.alt;
    return keyState.shift;
  }

  function isModifierHeldFromEvent(e: MouseEvent | null) {
    if (!CFG.modifierKey || CFG.modifierKey === "None") return false;
    if (!e) return false;
    if (CFG.modifierKey === "Control") return !!e.ctrlKey;
    if (CFG.modifierKey === "Alt") return !!e.altKey;
    return !!e.shiftKey;
  }

  const keyState = { shift: false, ctrl: false, alt: false };
  let tempChatEnabled = false;

  function updateKeyState(e: KeyboardEvent, state: boolean) {
    if (e.key === "Shift") keyState.shift = state;
    if (e.key === "Control" || e.key === "Ctrl") keyState.ctrl = state;
    if (e.key === "Alt") keyState.alt = state;
  }

  window.addEventListener(
    "keydown",
    (e: KeyboardEvent) => {
      updateKeyState(e, true);
      if (keyMatchesModifier(e)) {
        const graceActive = performance.now() <= graceUntilMs;
        if (graceActive) graceCaptured = true;
        tmLog("KEY", "down modifier", { graceActive, graceMs: CFG.modifierGraceMs });
      }
      if (
        shouldTriggerArrowUpEdit({
          enabled: CFG.editLastMessageOnArrowUp,
          key: e.key,
          altKey: e.altKey,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
          isComposing: e.isComposing,
          inputText: readInputText().text
        }) &&
        isTextboxTarget(e.target)
      ) {
        const ok = triggerEditLastMessage();
        tmLog("KEY", "arrow up edit last message", { ok });
        if (ok) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    },
    true
  );

  window.addEventListener(
    "keyup",
    (e: KeyboardEvent) => {
      updateKeyState(e, false);
      if (keyMatchesModifier(e)) {
        tmLog("KEY", "up modifier");
      }
    },
    true
  );

  let lastBlurLogAt = 0;
  window.addEventListener(
    "blur",
    () => {
      keyState.shift = false;
      keyState.ctrl = false;
      keyState.alt = false;
      if (!CFG.logBlur) return;
      const t = performance.now();
      if (t - lastBlurLogAt > 800) {
        lastBlurLogAt = t;
        tmLog("KEY", "window blur reset modifier");
      }
    },
    true
  );

  interface WaitForFinalTextArgs {
    snapshot: string;
    timeoutMs: number;
    quietMs: number;
  }

  interface WaitForFinalTextResult extends InputReadResult {
    ok: boolean;
    inputOk: boolean;
  }

  function waitForFinalText({ snapshot, timeoutMs, quietMs }: WaitForFinalTextArgs) {
    return new Promise<WaitForFinalTextResult>((resolve) => {
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
  }

  interface WaitForCodexSubmitReadyResult extends WaitForFinalTextResult {
    btn: HTMLButtonElement | null;
  }

  function waitForCodexSubmitReady({ snapshot, timeoutMs, quietMs }: WaitForFinalTextArgs) {
    return new Promise<WaitForCodexSubmitReadyResult>((resolve) => {
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
  }

  function isComposerFocused() {
    const textbox = findTextbox();
    if (!textbox) return false;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return false;
    return active === textbox || textbox.contains(active);
  }

  function isNonSkipModifierHeld() {
    const allowShift = CFG.modifierKey === "Shift";
    const allowCtrl = CFG.modifierKey === "Control";
    const allowAlt = CFG.modifierKey === "Alt";
    if (keyState.shift && !allowShift) return true;
    if (keyState.ctrl && !allowCtrl) return true;
    if (keyState.alt && !allowAlt) return true;
    return false;
  }

  function ensureNotGenerating(timeoutMs: number) {
    return new Promise<boolean>((resolve) => {
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
  }

  async function stopGeneratingIfPossible(timeoutMs: number) {
    const stopBtn = findStopGeneratingButton();
    if (!stopBtn) return true;

    tmLog("SEND", "stop generating before send", { btn: describeEl(stopBtn) });
    humanClick(stopBtn, "stop generating");

    const ok = await ensureNotGenerating(timeoutMs);
    if (!ok) {
      tmLog("SEND", "stop generating timeout");
    }
    return ok;
  }

  function isAttachmentButton(btn: HTMLButtonElement) {
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
  }

  function findCodexSubmitButton(): HTMLButtonElement | null {
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
  }

  async function waitForAvailableButton(
    finder: () => HTMLButtonElement | null,
    timeoutMs: number,
    reason: string
  ) {
    const t0 = performance.now();
    while (performance.now() - t0 <= timeoutMs) {
      const btn = finder();
      if (btn && !isDisabled(btn) && isElementVisible(btn)) return btn;
      await new Promise((r) => setTimeout(r, 80));
    }
    tmLog("WAIT", `${reason} button timeout`, { timeoutMs });
    return null;
  }

  async function clickSendWithAck() {
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

    humanClick(btn, "send");

    const t0 = performance.now();
    while (performance.now() - t0 <= CFG.sendAckTimeoutMs) {
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
  }

  let inFlight = false;
  let transcribeInFlight = false;
  let lastDictationSubmitClickAt = 0;
  let transcribeHookInstalled = false;

  async function runFlowAfterSubmitClick(submitBtnDesc: string, clickHeld: boolean) {
    if (inFlight) {
      tmLog("FLOW", "skip: inFlight already true");
      return;
    }
    inFlight = true;
    lastDictationSubmitClickAt = performance.now();

    try {
      const snap = readInputText();
      const snapshot = snap.text;

      graceUntilMs = performance.now() + CFG.modifierGraceMs;
      graceCaptured = false;
      const initialHeld = isModifierHeldNow();

      tmLog("FLOW", "submit click flow start", {
        btn: submitBtnDesc,
        inputFound: snap.ok,
        inputKind: snap.kind,
        snapshotLen: snapshot.length,
        snapshot,
        graceMs: CFG.modifierGraceMs
      });

      const finalRes = await waitForFinalText({
        snapshot,
        timeoutMs: CFG.finalTextTimeoutMs,
        quietMs: CFG.finalTextQuietMs
      });

      const heldDuring = initialHeld || graceCaptured || isModifierHeldNow() || clickHeld;

      const decision = decideAutoSend({ holdToSend: CFG.holdToSend, heldDuring });

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
  }

  type TranscribeMode = "codex" | "chatgpt";

  interface TranscribeFlowArgs {
    mode: TranscribeMode;
    beforeText: string;
    beforeInputOk: boolean;
  }

  async function runFlowAfterTranscribe({ mode, beforeText, beforeInputOk }: TranscribeFlowArgs) {
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
      await refreshSettings();
      if (!CFG.enabled) {
        tmLog("TRANSCRIBE", "auto-send disabled");
        return;
      }

      const heldDuring = isModifierHeldNow();
      const decision = decideAutoSend({ holdToSend: CFG.holdToSend, heldDuring });

      if (mode === "codex") {
        if (!CFG.allowAutoSendInCodex) {
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
          timeoutMs: CFG.finalTextTimeoutMs,
          quietMs: CFG.finalTextQuietMs
        });

        if (!submitRes.ok || !submitRes.btn) {
          tmLog("CODEX", "submit not ready");
          return;
        }

        humanClick(submitRes.btn, "codex submit");
        tmLog("CODEX", "submit clicked");
        return;
      }

      if (findStopGeneratingButton()) {
        tmLog("TRANSCRIBE", "skip: generation in progress");
        return;
      }

      if (performance.now() - lastDictationSubmitClickAt < CFG.finalTextTimeoutMs) {
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
        timeoutMs: CFG.finalTextTimeoutMs,
        quietMs: CFG.finalTextQuietMs
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
  }

  const TRANSCRIBE_HOOK_SOURCE = "tm-dictation-transcribe";
  const transcribeSnapshots = new Map<string, InputReadResult>();

  function injectPageTranscribeHook() {
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
  }

  function installTranscribeHook({ mode }: { mode: TranscribeMode }) {
    if (transcribeHookInstalled) return;
    transcribeHookInstalled = true;

    injectPageTranscribeHook();

    window.addEventListener("message", (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as { source?: string; type?: string; id?: string };
      if (!data || data.source !== TRANSCRIBE_HOOK_SOURCE) return;
      if (!data.type || !data.id) return;

      if (data.type === "start") {
        transcribeSnapshots.set(data.id, readInputText());
        return;
      }

      if (data.type === "complete") {
        const snapshot = transcribeSnapshots.get(data.id);
        if (snapshot) transcribeSnapshots.delete(data.id);
        void runFlowAfterTranscribe({
          mode,
          beforeText: snapshot?.text ?? "",
          beforeInputOk: snapshot?.ok ?? false
        });
      }
    });
  }

  function isInterestingButton(btn: HTMLButtonElement | null) {
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
  }

  function isCodexPath(pathname: string) {
    return pathname.includes("/codex") || pathname.includes("/codecs");
  }

  async function refreshSettings() {
    const res = await resolvedStorage.get(SETTINGS_DEFAULTS);
    const settings = normalizeSettings(res);
    CFG.modifierKey = settings.skipKey;
    if (CFG.modifierKey === "None") CFG.modifierKey = null;
    CFG.holdToSend = settings.holdToSend;
    CFG.allowAutoSendInCodex = settings.allowAutoSendInCodex;
    CFG.editLastMessageOnArrowUp = settings.editLastMessageOnArrowUp;
    CFG.autoExpandChatsEnabled = settings.autoExpandChats;
    CFG.autoTempChatEnabled = settings.autoTempChat;
    CFG.oneClickDeleteEnabled = settings.oneClickDelete;
    CFG.wideChatWidth = settings.wideChatWidth;
    tempChatEnabled = settings.tempChatEnabled;
    log("settings refreshed", {
      skipKey: CFG.modifierKey,
      holdToSend: CFG.holdToSend,
      allowAutoSendInCodex: CFG.allowAutoSendInCodex,
      editLastMessageOnArrowUp: CFG.editLastMessageOnArrowUp,
      autoExpandChats: CFG.autoExpandChatsEnabled,
      autoTempChat: CFG.autoTempChatEnabled,
      oneClickDelete: CFG.oneClickDeleteEnabled,
      wideChatWidth: CFG.wideChatWidth,
      tempChatEnabled
    });
    maybeEnableTempChat();
    updateOneClickDeleteState();
    updateWideChatState();
  }

  let graceUntilMs = 0;
  let graceCaptured = false;

  const TEMP_CHAT_ON_SELECTOR = 'button[aria-label="Turn on temporary chat"]';
  const TEMP_CHAT_OFF_SELECTOR = 'button[aria-label="Turn off temporary chat"]';
  const TEMP_CHAT_MAX_RETRIES = 5;
  const TEMP_CHAT_RETRY_MS = 300;
  const tempChatState: {
    retries: number;
    started: boolean;
    observer: MutationObserver | null;
    urlIntervalId: number | null;
    lastPath: string;
  } = {
    retries: 0,
    started: false,
    observer: null,
    urlIntervalId: null,
    lastPath: ""
  };

  function isTempChatActive() {
    return !!qs(TEMP_CHAT_OFF_SELECTOR);
  }

  function findVisibleBySelector(sel: string) {
    return (
      qsa<HTMLElement>(sel).find((el) => isElementVisible(el) && !el.hasAttribute("disabled")) ||
      null
    );
  }

  function persistTempChatEnabled(value: boolean) {
    tempChatEnabled = value;
    void resolvedStorage.set({ tempChatEnabled });
    tmLog("TEMPCHAT", "persist state", { ok: value });
  }

  function maybeEnableTempChat() {
    if (!CFG.autoTempChatEnabled || !tempChatEnabled || isTempChatActive()) {
      tempChatState.retries = 0;
      return;
    }

    const btn = findVisibleBySelector(TEMP_CHAT_ON_SELECTOR);
    if (!btn) return;

    humanClick(btn, "tempchat-enable");
    tmLog("TEMPCHAT", "auto-clicked on");

    setTimeout(() => {
      if (isTempChatActive()) {
        tmLog("TEMPCHAT", "enabled");
        tempChatState.retries = 0;
      } else if (++tempChatState.retries <= TEMP_CHAT_MAX_RETRIES) {
        tmLog("TEMPCHAT", `retry ${tempChatState.retries}`);
        maybeEnableTempChat();
      } else {
        tmLog("TEMPCHAT", "failed after retries");
        tempChatState.retries = 0;
      }
    }, TEMP_CHAT_RETRY_MS);
  }

  function handleTempChatManualToggle(e: MouseEvent) {
    if (!e.isTrusted) return;
    const target = e.target;
    if (!(target instanceof Element) || !target.closest) return;
    if (target.closest(TEMP_CHAT_ON_SELECTOR)) return persistTempChatEnabled(true);
    if (target.closest(TEMP_CHAT_OFF_SELECTOR)) return persistTempChatEnabled(false);
  }

  function startAutoTempChat() {
    if (tempChatState.started) return;
    tempChatState.started = true;
    tempChatState.lastPath = location.pathname + location.search;

    document.addEventListener("click", handleTempChatManualToggle, true);

    tempChatState.observer = new MutationObserver(() => maybeEnableTempChat());
    tempChatState.observer.observe(document.documentElement, { childList: true, subtree: true });

    tempChatState.urlIntervalId = window.setInterval(() => {
      const cur = location.pathname + location.search;
      if (cur !== tempChatState.lastPath) {
        tempChatState.lastPath = cur;
        tempChatState.retries = 0;
        maybeEnableTempChat();
      }
    }, 100);

    maybeEnableTempChat();
  }

  const WIDE_CHAT_STYLE_ID = "qqrm-wide-chat-style";
  const wideChatState: {
    started: boolean;
    observer: MutationObserver | null;
    resizeHandler: (() => void) | null;
    baseWidthPx: number | null;
    scheduled: boolean;
  } = {
    started: false,
    observer: null,
    resizeHandler: null,
    baseWidthPx: null,
    scheduled: false
  };

  function findWideChatContentEl() {
    return (
      document.querySelector('main [class*="max-w-(--thread-content-max-width)"]') ||
      document.querySelector('[class*="max-w-(--thread-content-max-width)"]')
    );
  }

  function ensureWideChatBaseWidth() {
    if (wideChatState.baseWidthPx !== null) return wideChatState.baseWidthPx;
    const contentEl = findWideChatContentEl();
    if (!contentEl) return null;
    const rect = contentEl.getBoundingClientRect();
    if (rect.width <= 1) return null;
    wideChatState.baseWidthPx = Math.round(rect.width);
    return wideChatState.baseWidthPx;
  }

  function ensureWideChatStyle() {
    let style = document.getElementById(WIDE_CHAT_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = WIDE_CHAT_STYLE_ID;
      document.documentElement.appendChild(style);
    }
    return style;
  }

  function removeWideChatStyle() {
    const style = document.getElementById(WIDE_CHAT_STYLE_ID);
    if (style) style.remove();
  }

  function applyWideChatWidth() {
    if (CFG.wideChatWidth <= 0) return;
    const basePx = ensureWideChatBaseWidth();
    if (!basePx) return;
    const style = ensureWideChatStyle();
    updateWideChatStyle(style, {
      basePx,
      wideChatWidth: CFG.wideChatWidth,
      windowWidth: window.innerWidth
    });
  }

  function scheduleWideChatUpdate() {
    if (wideChatState.scheduled) return;
    wideChatState.scheduled = true;
    requestAnimationFrame(() => {
      wideChatState.scheduled = false;
      applyWideChatWidth();
    });
  }

  function startWideChat() {
    if (wideChatState.started) return;
    wideChatState.started = true;
    wideChatState.baseWidthPx = null;
    wideChatState.resizeHandler = () => scheduleWideChatUpdate();
    window.addEventListener("resize", wideChatState.resizeHandler, { passive: true });
    wideChatState.observer = new MutationObserver((mutations) => {
      const style = document.getElementById(WIDE_CHAT_STYLE_ID);
      if (
        style &&
        mutations.length > 0 &&
        mutations.every((mutation) => style.contains(mutation.target))
      ) {
        return;
      }
      scheduleWideChatUpdate();
    });
    wideChatState.observer.observe(document.documentElement, { childList: true, subtree: true });
    scheduleWideChatUpdate();
  }

  function stopWideChat() {
    if (!wideChatState.started) return;
    wideChatState.started = false;
    if (wideChatState.resizeHandler) {
      window.removeEventListener("resize", wideChatState.resizeHandler);
      wideChatState.resizeHandler = null;
    }
    if (wideChatState.observer) {
      wideChatState.observer.disconnect();
      wideChatState.observer = null;
    }
    wideChatState.baseWidthPx = null;
    removeWideChatStyle();
  }

  function updateWideChatState() {
    if (CFG.wideChatWidth > 0) {
      if (!wideChatState.started) startWideChat();
      else scheduleWideChatUpdate();
      return;
    }
    stopWideChat();
  }

  const ONE_CLICK_DELETE_HOOK_MARK = "data-qqrm-oneclick-del-hooked";
  const ONE_CLICK_DELETE_X_MARK = "data-qqrm-oneclick-del-x";
  const ONE_CLICK_DELETE_STYLE_ID = "qqrm-oneclick-del-style";
  const ONE_CLICK_DELETE_ROOT_FLAG = "data-qqrm-oneclick-deleting";
  const ONE_CLICK_DELETE_BUTTON_SELECTOR =
    'button[data-testid^="history-item-"][data-testid$="-options"]';
  const ONE_CLICK_DELETE_RIGHT_ZONE_PX = 38;

  const ONE_CLICK_DELETE_BTN_H = 36;
  const ONE_CLICK_DELETE_BTN_W = 72;
  const ONE_CLICK_DELETE_X_SIZE = 26;
  const ONE_CLICK_DELETE_X_RIGHT = 6;
  const ONE_CLICK_DELETE_DOTS_LEFT = 10;

  const oneClickDeleteState: {
    started: boolean;
    deleting: boolean;
    observer: MutationObserver | null;
    intervalId: number | null;
  } = {
    started: false,
    deleting: false,
    observer: null,
    intervalId: null
  };

  function setOneClickDeleteDeleting(on: boolean) {
    if (on) document.documentElement.setAttribute(ONE_CLICK_DELETE_ROOT_FLAG, "1");
    else document.documentElement.removeAttribute(ONE_CLICK_DELETE_ROOT_FLAG);
  }

  function ensureOneClickDeleteStyle() {
    if (document.getElementById(ONE_CLICK_DELETE_STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = ONE_CLICK_DELETE_STYLE_ID;
    st.textContent = `
      ${ONE_CLICK_DELETE_BUTTON_SELECTOR}{
        width: ${ONE_CLICK_DELETE_BTN_W}px !important;
        height: ${ONE_CLICK_DELETE_BTN_H}px !important;
        border-radius: 12px !important;
        opacity: 1 !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        position: relative !important;
        padding: 0 !important;
        overflow: hidden !important;
      }

      ${ONE_CLICK_DELETE_BUTTON_SELECTOR} svg{
        position: absolute !important;
        left: ${ONE_CLICK_DELETE_DOTS_LEFT}px !important;
        top: 50% !important;
        transform: translateY(-50%) !important;
        pointer-events: none !important;
      }

      ${ONE_CLICK_DELETE_BUTTON_SELECTOR} > span[${ONE_CLICK_DELETE_X_MARK}="1"]{
        position: absolute;
        right: ${ONE_CLICK_DELETE_X_RIGHT}px;
        top: 50%;
        transform: translateY(-50%);
        width: ${ONE_CLICK_DELETE_X_SIZE}px;
        height: ${ONE_CLICK_DELETE_X_SIZE}px;
        border-radius: 9px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        font-weight: 600;
        line-height: 18px;
        color: #ff6b6b;
        background: rgba(255, 90, 90, 0.08);
        border: 1px solid rgba(255, 90, 90, 0.2);
        box-shadow: -1px 0 0 rgba(255, 255, 255, 0.08) inset;
        opacity: 0.0;
        transition: opacity 140ms ease, background 140ms ease, transform 140ms ease;
        user-select: none;
        pointer-events: none;
      }

      ${ONE_CLICK_DELETE_BUTTON_SELECTOR}:hover > span[${ONE_CLICK_DELETE_X_MARK}="1"],
      ${ONE_CLICK_DELETE_BUTTON_SELECTOR}:focus-visible > span[${ONE_CLICK_DELETE_X_MARK}="1"]{
        opacity: 1.0;
        background: rgba(255, 90, 90, 0.18);
        transform: translateY(-50%) scale(1.02);
      }

      @media (prefers-color-scheme: light) {
        ${ONE_CLICK_DELETE_BUTTON_SELECTOR} > span[${ONE_CLICK_DELETE_X_MARK}="1"]{
          color: #d93636;
          background: rgba(217, 54, 54, 0.08);
          border-color: rgba(217, 54, 54, 0.25);
          box-shadow: -1px 0 0 rgba(0, 0, 0, 0.08) inset;
        }
        ${ONE_CLICK_DELETE_BUTTON_SELECTOR}:hover > span[${ONE_CLICK_DELETE_X_MARK}="1"],
        ${ONE_CLICK_DELETE_BUTTON_SELECTOR}:focus-visible > span[${ONE_CLICK_DELETE_X_MARK}="1"]{
          background: rgba(217, 54, 54, 0.18);
        }
      }

      html[${ONE_CLICK_DELETE_ROOT_FLAG}="1"] div[data-testid="modal-delete-conversation-confirmation"]{
        opacity: 0 !important;
        pointer-events: none !important;
      }
      html[${ONE_CLICK_DELETE_ROOT_FLAG}="1"] [data-radix-menu-content][role="menu"]{
        opacity: 0 !important;
        pointer-events: none !important;
      }
      html[${ONE_CLICK_DELETE_ROOT_FLAG}="1"] [data-radix-popper-content-wrapper]{
        opacity: 0 !important;
        pointer-events: none !important;
      }
      html[${ONE_CLICK_DELETE_ROOT_FLAG}="1"] *{
        animation-duration: 0.001ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.001ms !important;
      }
    `;
    const host = document.head ?? document.documentElement;
    if (!host) return;
    host.appendChild(st);
  }

  function removeOneClickDeleteStyle() {
    const st = document.getElementById(ONE_CLICK_DELETE_STYLE_ID);
    if (st) st.remove();
  }

  function ensureOneClickDeleteXSpan(btn: HTMLElement) {
    let x = btn.querySelector<HTMLSpanElement>(`span[${ONE_CLICK_DELETE_X_MARK}="1"]`);
    if (x) return x;
    x = document.createElement("span");
    x.setAttribute(ONE_CLICK_DELETE_X_MARK, "1");
    x.setAttribute("aria-label", "Delete chat");
    x.title = "Delete chat";
    x.textContent = "×";
    btn.appendChild(x);
    return x;
  }

  function clearOneClickDeleteButtons() {
    const btns = qsa<HTMLElement>(ONE_CLICK_DELETE_BUTTON_SELECTOR);
    for (const btn of btns) {
      btn.removeAttribute(ONE_CLICK_DELETE_HOOK_MARK);
      const x = btn.querySelector(`span[${ONE_CLICK_DELETE_X_MARK}="1"]`);
      if (x) x.remove();
    }
  }

  function hookOneClickDeleteButton(btn: HTMLElement) {
    if (!btn || btn.nodeType !== 1) return;
    if (btn.hasAttribute(ONE_CLICK_DELETE_HOOK_MARK)) return;
    btn.setAttribute(ONE_CLICK_DELETE_HOOK_MARK, "1");
    ensureOneClickDeleteXSpan(btn);
  }

  function isOneClickDeleteRightZone(btn: HTMLElement, ev: MouseEvent) {
    const rect = btn.getBoundingClientRect();
    const localX = ev.clientX - rect.left;
    return localX >= rect.width - ONE_CLICK_DELETE_RIGHT_ZONE_PX;
  }

  async function runOneClickDeleteFlow() {
    if (oneClickDeleteState.deleting) return;
    oneClickDeleteState.deleting = true;
    try {
      const deleteItem = await waitMenuForOneClickDeleteItem(1500);
      if (!deleteItem) return;
      setOneClickDeleteDeleting(true);
      humanClick(deleteItem as HTMLElement, "oneclick-delete-menu");

      const modal = await waitPresent(
        'div[data-testid="modal-delete-conversation-confirmation"]',
        document,
        2000
      );
      if (!modal) return;

      const confirmBtn =
        modal.querySelector('button[data-testid="delete-conversation-confirm-button"]') ||
        (await waitPresent(
          'button[data-testid="delete-conversation-confirm-button"]',
          modal,
          1500
        ));

      if (!confirmBtn) return;
      humanClick(confirmBtn as HTMLElement, "oneclick-delete-confirm");
    } finally {
      await sleep(120);
      setOneClickDeleteDeleting(false);
      oneClickDeleteState.deleting = false;
    }
  }

  function refreshOneClickDelete() {
    if (!CFG.oneClickDeleteEnabled) return;
    ensureOneClickDeleteStyle();
    const btns = qsa<HTMLElement>(ONE_CLICK_DELETE_BUTTON_SELECTOR);
    for (const btn of btns) hookOneClickDeleteButton(btn);
  }

  function handleOneClickDeleteClick(ev: MouseEvent) {
    if (!CFG.oneClickDeleteEnabled) return;
    if (!ev.isTrusted) return;
    const target = ev.target;
    if (!(target instanceof Element) || !target.closest) return;
    const btn = target.closest(ONE_CLICK_DELETE_BUTTON_SELECTOR);
    if (!(btn instanceof HTMLElement)) return;
    if (!isOneClickDeleteRightZone(btn, ev)) return;
    setTimeout(() => {
      runOneClickDeleteFlow().catch(() => {});
    }, 0);
  }

  function startOneClickDelete() {
    if (oneClickDeleteState.started) return;
    oneClickDeleteState.started = true;

    document.addEventListener("click", handleOneClickDeleteClick, true);

    refreshOneClickDelete();
    oneClickDeleteState.intervalId = window.setInterval(refreshOneClickDelete, 1200);

    oneClickDeleteState.observer = new MutationObserver(() => refreshOneClickDelete());
    oneClickDeleteState.observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function stopOneClickDelete() {
    if (!oneClickDeleteState.started) return;
    oneClickDeleteState.started = false;

    document.removeEventListener("click", handleOneClickDeleteClick, true);

    if (oneClickDeleteState.intervalId !== null) {
      window.clearInterval(oneClickDeleteState.intervalId);
      oneClickDeleteState.intervalId = null;
    }
    if (oneClickDeleteState.observer) {
      oneClickDeleteState.observer.disconnect();
      oneClickDeleteState.observer = null;
    }

    clearOneClickDeleteButtons();
    removeOneClickDeleteStyle();
    setOneClickDeleteDeleting(false);
  }

  function updateOneClickDeleteState() {
    if (CFG.oneClickDeleteEnabled) startOneClickDelete();
    else stopOneClickDelete();
  }

  void refreshSettings();
  resolvedStorage.onChanged?.(
    (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => {
      if (areaName !== "sync" && areaName !== "local") return;
      if (
        !changes ||
        (!("autoExpandChats" in changes) &&
          !("skipKey" in changes) &&
          !("holdToSend" in changes) &&
          !("allowAutoSendInCodex" in changes) &&
          !("editLastMessageOnArrowUp" in changes) &&
          !("autoTempChat" in changes) &&
          !("oneClickDelete" in changes) &&
          !("wideChatWidth" in changes) &&
          !("tempChatEnabled" in changes))
      ) {
        return;
      }
      if ("autoExpandChats" in changes) {
        const prev = Boolean(changes.autoExpandChats.oldValue);
        const next = Boolean(changes.autoExpandChats.newValue);
        if (next && !prev) {
          autoExpandReset();
          startAutoExpand();
        }
        if (!next && prev) {
          stopAutoExpand();
        }
      }
      void refreshSettings();
    }
  );

  const AUTO_EXPAND_LOOP_MS = 400;
  const AUTO_EXPAND_CLICK_COOLDOWN_MS = 1500;
  const autoExpandState: {
    running: boolean;
    started: boolean;
    completed: boolean;
    lastClickAtByKey: Map<string, number>;
    intervalId: number | null;
    observer: MutationObserver | null;
  } = {
    running: false,
    started: false,
    completed: false,
    lastClickAtByKey: new Map(),
    intervalId: null,
    observer: null
  };

  function autoExpandCanClick(key: string) {
    const t = autoExpandState.lastClickAtByKey.get(key) || 0;
    return Date.now() - t > AUTO_EXPAND_CLICK_COOLDOWN_MS;
  }

  function autoExpandMarkClick(key: string) {
    autoExpandState.lastClickAtByKey.set(key, Date.now());
  }

  function autoExpandDispatchClick(el: HTMLElement) {
    const seq = ["pointerdown", "mousedown", "mouseup", "click"];
    for (const t of seq) {
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    }
  }

  function autoExpandReset() {
    autoExpandState.running = false;
    autoExpandState.started = false;
    autoExpandState.completed = false;
    autoExpandState.lastClickAtByKey.clear();
  }

  function autoExpandClickIfPossible(key: string, el: HTMLElement | null, reason: string) {
    if (!el) return false;
    if (!isElementVisible(el)) return false;
    if (!autoExpandCanClick(key)) return false;
    autoExpandMarkClick(key);
    tmLog("AUTOEXPAND", `click ${key}`, { preview: reason });
    autoExpandDispatchClick(el);
    return true;
  }

  function autoExpandSidebarEl() {
    return qs<HTMLElement>("#stage-slideover-sidebar");
  }

  function autoExpandSidebarIsOpen() {
    const sb = autoExpandSidebarEl();
    if (!sb) return false;
    if (!isElementVisible(sb)) return false;
    return sb.getBoundingClientRect().width >= 120;
  }

  function autoExpandOpenSidebarButton() {
    return (
      qs<HTMLButtonElement>(
        '#stage-sidebar-tiny-bar button[aria-label="Open sidebar"][aria-controls="stage-slideover-sidebar"]'
      ) ||
      qs<HTMLButtonElement>(
        'button[aria-label="Open sidebar"][aria-controls="stage-slideover-sidebar"]'
      )
    );
  }

  function autoExpandEnsureSidebarOpen() {
    if (autoExpandSidebarIsOpen()) return false;
    const btn = autoExpandOpenSidebarButton();
    return autoExpandClickIfPossible("openSidebar", btn, "sidebar closed by geometry");
  }

  function autoExpandChatHistoryNav() {
    const sb = autoExpandSidebarEl();
    if (!sb) return null;
    return sb.querySelector('nav[aria-label="Chat history"]');
  }

  function autoExpandFindYourChatsSection(nav: Element | null) {
    if (!nav) return null;

    const sections = Array.from(nav.querySelectorAll("div.group\\/sidebar-expando-section"));
    for (const sec of sections) {
      const t = norm(sec.textContent);
      if (
        t.includes("your chats") ||
        t.includes("your charts") ||
        t.includes("чаты") ||
        t.includes("история")
      ) {
        return sec;
      }
    }

    if (sections.length >= 4) return sections[3];
    return null;
  }

  function autoExpandSectionCollapsed(sec: Element) {
    const cls = String((sec as HTMLElement).className || "");
    if (cls.includes("sidebar-collapsed-section-margin-bottom")) return true;
    if (cls.includes("sidebar-expanded-section-margin-bottom")) return false;

    if (cls.includes("--sidebar-collapsed-section-margin-bottom")) return true;
    if (cls.includes("--sidebar-expanded-section-margin-bottom")) return false;

    return false;
  }

  function autoExpandExpandYourChats() {
    if (!autoExpandSidebarIsOpen()) return false;

    const nav = autoExpandChatHistoryNav();
    if (!nav || !isElementVisible(nav)) return false;

    const sec = autoExpandFindYourChatsSection(nav);
    if (!sec) return false;

    if (!autoExpandSectionCollapsed(sec)) return false;

    const btn =
      (sec as HTMLElement).querySelector("button.text-token-text-tertiary.flex.w-full") ||
      (sec as HTMLElement).querySelector("button") ||
      (sec as HTMLElement).querySelector('[role="button"]');

    return autoExpandClickIfPossible(
      "expandYourChats",
      btn as HTMLElement | null,
      "section looks collapsed"
    );
  }

  function autoExpandTryFinish() {
    if (!autoExpandSidebarIsOpen()) {
      autoExpandEnsureSidebarOpen();
      return false;
    }

    const nav = autoExpandChatHistoryNav();
    if (!nav || !isElementVisible(nav)) return false;

    const sec = autoExpandFindYourChatsSection(nav);
    if (!sec) return false;

    if (!autoExpandSectionCollapsed(sec)) return true;

    return autoExpandExpandYourChats();
  }

  function stopAutoExpand() {
    if (autoExpandState.intervalId !== null) {
      window.clearInterval(autoExpandState.intervalId);
      autoExpandState.intervalId = null;
    }
    if (autoExpandState.observer) {
      autoExpandState.observer.disconnect();
      autoExpandState.observer = null;
    }
  }

  function autoExpandTick() {
    if (!CFG.autoExpandChatsEnabled) return;
    if (autoExpandState.completed) return;
    if (autoExpandState.running) return;
    autoExpandState.running = true;
    try {
      const done = autoExpandTryFinish();
      if (done) {
        autoExpandState.completed = true;
        stopAutoExpand();
      }
    } catch (e) {
      tmLog("AUTOEXPAND", "tick error", {
        preview: String((e && (e as Error).stack) || (e as Error).message || e)
      });
    } finally {
      autoExpandState.running = false;
    }
  }

  function startAutoExpand() {
    if (autoExpandState.started) return;
    autoExpandState.started = true;
    autoExpandTick();

    autoExpandState.intervalId = window.setInterval(autoExpandTick, AUTO_EXPAND_LOOP_MS);

    autoExpandState.observer = new MutationObserver(() => autoExpandTick());
    autoExpandState.observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        startAutoExpand();
        startAutoTempChat();
      },
      { once: true }
    );
  } else {
    startAutoExpand();
    startAutoTempChat();
  }

  installTranscribeHook({ mode: isCodexPath(location.pathname) ? "codex" : "chatgpt" });

  document.addEventListener(
    "click",
    (e: MouseEvent) => {
      const target = e.target;
      const btn = target instanceof Element && target.closest ? target.closest("button") : null;
      if (!btn) return;

      const btnDesc = describeEl(btn);

      if (CFG.logClicks && btn instanceof HTMLButtonElement && isInterestingButton(btn)) {
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

      if (CFG.enabled && btn instanceof HTMLButtonElement && isSubmitDictationButton(btn)) {
        void (async () => {
          await refreshSettings();
          if (!isCodexPath(location.pathname) || CFG.allowAutoSendInCodex) {
            await runFlowAfterSubmitClick(btnDesc, isModifierHeldFromEvent(e));
          } else {
            tmLog("FLOW", "auto-send skipped on Codex path");
          }
        })();
      }
    },
    true
  );

  tmLog("BOOT", "content script loaded", { preview: location.href });
};
