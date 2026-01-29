"use strict";
var cgptBetterExp = (() => {
  // src/domain/settings.ts
  var SETTINGS_DEFAULTS = {
    autoSend: true,
    allowAutoSendInCodex: true,
    editLastMessageOnArrowUp: true,
    autoExpandChats: true,
    autoTempChat: true,
    tempChatEnabled: false,
    oneClickDelete: true,
    startDictation: true,
    ctrlEnterSends: true,
    showCompatibilityWarnings: true,
    wideChatWidth: 0
  };

  // src/lib/utils.ts
  function norm(value) {
    return String(value || "").toLowerCase();
  }
  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function isElementVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none") return false;
    if (cs.visibility === "hidden") return false;
    if (cs.opacity === "0") return false;
    return true;
  }
  function isDisabled(el) {
    if (!el) return true;
    if (el instanceof HTMLButtonElement && el.disabled) return true;
    if (el.hasAttribute("disabled")) return true;
    const ariaDisabled = el.getAttribute("aria-disabled");
    if (ariaDisabled && ariaDisabled !== "false") return true;
    return false;
  }
  function normalizeSettings(data) {
    const base = SETTINGS_DEFAULTS;
    const obj = data && typeof data === "object" ? data : {};
    const legacySkipKey = typeof obj.skipKey === "string" ? obj.skipKey : null;
    const legacyHoldToSend = typeof obj.holdToSend === "boolean" ? obj.holdToSend : null;
    void legacyHoldToSend;
    const autoSend = typeof obj.autoSend === "boolean" ? obj.autoSend : legacySkipKey === "None" ? false : true;
    const readBool = (key) => {
      const v = obj[key];
      return typeof v === "boolean" ? v : base[key];
    };
    const readNumber = (key) => {
      const v = obj[key];
      return typeof v === "number" && Number.isFinite(v) ? v : base[key];
    };
    const wideChatWidth = (() => {
      const n = readNumber("wideChatWidth");
      return Math.min(100, Math.max(0, n));
    })();
    return {
      ...base,
      // special-case legacy
      autoSend,
      // bools (всё без копипасты)
      allowAutoSendInCodex: readBool("allowAutoSendInCodex"),
      editLastMessageOnArrowUp: readBool("editLastMessageOnArrowUp"),
      autoExpandChats: readBool("autoExpandChats"),
      autoTempChat: readBool("autoTempChat"),
      tempChatEnabled: readBool("tempChatEnabled"),
      oneClickDelete: readBool("oneClickDelete"),
      startDictation: readBool("startDictation"),
      ctrlEnterSends: readBool("ctrlEnterSends"),
      showCompatibilityWarnings: readBool("showCompatibilityWarnings"),
      // numbers
      wideChatWidth
    };
  }
  function isThenable(value) {
    return Boolean(value) && typeof value.then === "function";
  }

  // src/application/featureContext.ts
  var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  function short(value, n = 140) {
    if (value == null) return "";
    const t = String(value).replace(/\s+/g, " ").trim();
    if (t.length <= n) return t;
    return t.slice(0, n) + "...";
  }
  function describeEl(el) {
    if (!el) return "null";
    const tag = el.tagName ? el.tagName.toLowerCase() : "node";
    const id = el.id ? `#${el.id}` : "";
    const dt = el.getAttribute ? el.getAttribute("data-testid") : "";
    const aria = el.getAttribute ? el.getAttribute("aria-label") : "";
    const title = el.getAttribute ? el.getAttribute("title") : "";
    const txt = el.textContent ? short(el.textContent, 60) : "";
    const bits = [];
    bits.push(`${tag}${id}`);
    if (dt) bits.push(`data-testid=${dt}`);
    if (aria) bits.push(`aria="${short(aria, 60)}"`);
    if (title) bits.push(`title="${short(title, 60)}"`);
    if (txt) bits.push(`text="${txt}"`);
    return bits.join(" ");
  }
  function createLogger(debugEnabled) {
    const BOOT_T0 = performance.now();
    let logCount = 0;
    const nowMs = () => performance.now() - BOOT_T0 | 0;
    const debug = (scope, message, fields) => {
      var _a, _b, _c;
      if (!debugEnabled) return;
      logCount += 1;
      const t = String(nowMs()).padStart(6, " ");
      let tail = "";
      if (fields && typeof fields === "object") {
        const allow = [
          "heldDuring",
          "autoSendEnabled",
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
        const parts = [];
        for (const k of allow) {
          if (k in fields) parts.push(`${k}=${String(fields[k])}`);
        }
        if ("preview" in fields) parts.push(`preview="${short(String((_a = fields.preview) != null ? _a : ""), 120)}"`);
        if ("snapshot" in fields)
          parts.push(`snapshot="${short(String((_b = fields.snapshot) != null ? _b : ""), 120)}"`);
        if ("btn" in fields) parts.push(`btn="${short(String((_c = fields.btn) != null ? _c : ""), 160)}"`);
        if (parts.length) tail = " | " + parts.join(" ");
      }
      console.log(`[TM DictationAutoSend] #${logCount} ${t} ${scope}: ${message}${tail}`);
    };
    return { isEnabled: debugEnabled, debug };
  }
  function createFeatureContext({
    settings,
    storagePort,
    debugEnabled
  }) {
    const logger = createLogger(debugEnabled);
    const waitPresent = async (sel, root = document, timeoutMs = 2500) => {
      const t0 = performance.now();
      while (performance.now() - t0 < timeoutMs) {
        const el = root.querySelector(sel);
        if (el) return el;
        await sleep(25);
      }
      return null;
    };
    const waitGone = async (sel, root = document, timeoutMs = 2500) => {
      const t0 = performance.now();
      while (performance.now() - t0 < timeoutMs) {
        const el = root.querySelector(sel);
        if (!el) return true;
        await sleep(25);
      }
      return !root.querySelector(sel);
    };
    const humanClick = (el, why) => {
      if (!el) return false;
      try {
        if (typeof el.focus === "function") el.focus();
      } catch {
      }
      try {
        el.scrollIntoView({ block: "center", inline: "center" });
      } catch {
      }
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
      } catch {
      }
      try {
        el.dispatchEvent(new MouseEvent("mousedown", common));
      } catch {
      }
      try {
        el.dispatchEvent(
          new PointerEvent("pointerup", {
            ...common,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true
          })
        );
      } catch {
      }
      try {
        el.dispatchEvent(new MouseEvent("mouseup", common));
      } catch {
      }
      try {
        el.dispatchEvent(new MouseEvent("click", common));
      } catch {
      }
      logger.debug("UI", `humanClick ${why}`, { preview: describeEl(el) });
      return true;
    };
    const debounceScheduler = (fn, delayMs) => {
      let timeoutId = null;
      const schedule = () => {
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        timeoutId = window.setTimeout(() => {
          timeoutId = null;
          fn();
        }, delayMs);
      };
      const cancel = () => {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
          timeoutId = null;
        }
      };
      return { schedule, cancel };
    };
    const safeQuery = (sel, root = document) => {
      try {
        return root.querySelector(sel);
      } catch {
        return null;
      }
    };
    return {
      settings,
      storagePort,
      logger,
      keyState: { shift: false, ctrl: false, alt: false },
      helpers: { waitPresent, waitGone, humanClick, debounceScheduler, safeQuery }
    };
  }

  // src/lib/trace.ts
  var MAX = 500;
  function getBuf() {
    const w = window;
    if (!w.__CGPTBE_TRACE__) w.__CGPTBE_TRACE__ = [];
    return w.__CGPTBE_TRACE__;
  }
  function isTraceEnabled() {
    try {
      return localStorage.getItem("cgptbe.trace") === "1";
    } catch {
      return false;
    }
  }
  function trace(tag, msg, data, level = "log") {
    if (!isTraceEnabled()) return;
    const ts = Date.now();
    const entry = {
      ts,
      iso: new Date(ts).toISOString(),
      level,
      tag,
      msg,
      data
    };
    try {
      const stack = new Error().stack;
      if (stack) entry.stack = stack.split("\n").slice(2, 10).join("\n");
    } catch {
    }
    const buf = getBuf();
    buf.push(entry);
    if (buf.length > MAX) buf.splice(0, buf.length - MAX);
    const prefix = `[cgptbe][${entry.iso}][${entry.tag}]`;
    if (level === "warn") console.warn(prefix, msg, data != null ? data : "");
    else if (level === "error") console.error(prefix, msg, data != null ? data : "");
    else console.log(prefix, msg, data != null ? data : "");
  }
  function createTrace(tag) {
    return {
      log: (msg, data) => trace(tag, msg, data, "log"),
      info: (msg, data) => trace(tag, msg, data, "log"),
      warn: (msg, data) => trace(tag, msg, data, "warn"),
      error: (msg, data) => trace(tag, msg, data, "error")
    };
  }

  // src/features/dictationAutoSend.ts
  var log = createTrace("dictation");
  var TRANSCRIBE_HOOK_SOURCE = "tm-dictation-transcribe";
  var DEFAULT_CONFIG = {
    autoSendEnabled: true,
    allowAutoSendInCodex: true,
    finalTextTimeoutMs: 25e3,
    finalTextQuietMs: 320,
    sendAckTimeoutMs: 4500,
    logClicks: true
  };
  var DICTATION_COOLDOWN_MS = 400;
  var AUTO_SEND_COOLDOWN_MS = 2e3;
  function initDictationAutoSendFeature(ctx) {
    const cfg = { ...DEFAULT_CONFIG };
    let inFlight = false;
    let transcribeHookInstalled = false;
    let lastDictationToggleAt = 0;
    let lastState = "NONE";
    let lastStateChangedAt = performance.now();
    let lastSubmitSeenAt = 0;
    let lastAutoSendTriggeredAt = 0;
    let lastShiftCancelAt = 0;
    let lastTranscribeCompleteAt = 0;
    let lastTranscriptId = "";
    let composerFooterObserver = null;
    let composerRootObserver = null;
    let composerFooterNode = null;
    const tmLog = (msg, fields) => {
      const input = readInputText();
      const payload = {
        state: getDictationUiState(),
        inputLen: input.text.length,
        preview: short2(input.text),
        transcriptId: lastTranscriptId || void 0,
        transcribeCompleteAt: lastTranscribeCompleteAt || void 0,
        ...fields
      };
      console.debug("[cgptbe][dictation]", msg, payload);
    };
    const qs = (sel, root = document) => root.querySelector(sel);
    const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    const short2 = (value, n = 140) => {
      if (value == null) return "";
      const t = String(value).replace(/\s+/g, " ").trim();
      if (t.length <= n) return t;
      return t.slice(0, n) + "...";
    };
    const describeEl2 = (el) => {
      if (!el) return "null";
      const tag = el.tagName ? el.tagName.toLowerCase() : "node";
      const id = el.id ? `#${el.id}` : "";
      const dt = el.getAttribute ? el.getAttribute("data-testid") : "";
      const aria = el.getAttribute ? el.getAttribute("aria-label") : "";
      const title = el.getAttribute ? el.getAttribute("title") : "";
      const txt = el.textContent ? short2(el.textContent, 60) : "";
      const bits = [];
      bits.push(`${tag}${id}`);
      if (dt) bits.push(`data-testid=${dt}`);
      if (aria) bits.push(`aria="${short2(aria, 60)}"`);
      if (title) bits.push(`title="${short2(title, 60)}"`);
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
    const findComposerInput2 = () => {
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
    const readTextboxText = (el) => {
      if (!el) return "";
      if (el instanceof HTMLTextAreaElement) return el.value || "";
      return String(el.innerText || el.textContent || "").replace(/\u00A0/g, " ");
    };
    const readInputText = () => {
      const el = findTextbox();
      if (!el) return { ok: false, kind: "none", text: "" };
      const kind = el instanceof HTMLTextAreaElement ? "textarea" : "contenteditable";
      return { ok: true, kind, text: readTextboxText(el) };
    };
    const findSendButton2 = () => qs('[data-testid="send-button"]') || qs("#composer-submit-button") || qs("button.composer-submit-btn") || qs("form button[type='submit']") || qs('button[aria-label*="Send"]') || qs('[role="button"][aria-label*="Send"]') || qs('button[aria-label*="\u041E\u0442\u043F\u0440\u0430\u0432"]') || null;
    const isSubmitDictationButton = (btn) => {
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
        const promptEl = document.getElementById("prompt-textarea") || document.querySelector('[data-testid="prompt-textarea"]');
        const parentForm = btn.closest("form");
        const inComposerFooter = !!btn.closest('[data-testid="composer-footer-actions"]');
        const inComposerForm = !!(promptEl && parentForm && parentForm.contains(promptEl));
        if (inComposerFooter || inComposerForm) return true;
      }
      if (a.includes("submit dictation")) return true;
      if (a.includes("dictation") && (a.includes("submit") || a.includes("accept") || a.includes("confirm")))
        return true;
      if (a.includes("\u0433\u043E\u0442\u043E\u0432\u043E")) return true;
      if (a.includes("\u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0434")) return true;
      if (a.includes("\u043F\u0440\u0438\u043D\u044F\u0442\u044C")) return true;
      if (dt.includes("dictation") && (dt.includes("submit") || dt.includes("done") || dt.includes("finish")))
        return true;
      if (t.includes("submit dictation")) return true;
      if (txt.includes("submit dictation")) return true;
      return false;
    };
    const isSendButton = (btn) => {
      if (!btn) return false;
      const sendBtn = findSendButton2();
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
      if (aria.includes("\u043E\u0442\u043F\u0440\u0430\u0432")) return true;
      if (title.includes("send")) return true;
      if (title.includes("\u043E\u0442\u043F\u0440\u0430\u0432")) return true;
      return false;
    };
    const isInterestingButton = (btn) => {
      if (!btn) return false;
      const a = norm(btn.getAttribute("aria-label"));
      const t = norm(btn.getAttribute("title"));
      const dt = norm(btn.getAttribute("data-testid"));
      if (dt.includes("send") || dt.includes("stop") || dt.includes("voice") || dt.includes("dict"))
        return true;
      if (a.includes("send") || a.includes("stop") || a.includes("dictat") || a.includes("voice"))
        return true;
      if (a.includes("\u043E\u0442\u043F\u0440\u0430\u0432") || a.includes("\u043E\u0441\u0442\u0430\u043D\u043E\u0432") || a.includes("\u0434\u0438\u043A\u0442\u043E\u0432") || a.includes("\u043C\u0438\u043A\u0440\u043E\u0444"))
        return true;
      if (t.includes("send") || t.includes("stop") || t.includes("voice") || t.includes("dict"))
        return true;
      return false;
    };
    const isCodexPath = (pathname) => pathname.includes("/codex") || pathname.includes("/codecs");
    const findStopGeneratingButton = () => {
      const candidates = qsa("button, [role='button']").filter((b) => {
        const a = norm(b.getAttribute("aria-label"));
        const t = norm(b.getAttribute("title"));
        const dt = norm(b.getAttribute("data-testid"));
        if (dt.includes("stop")) return true;
        if (a.includes("stop generating")) return true;
        if (a.includes("stop")) return true;
        if (a.includes("\u043E\u0441\u0442\u0430\u043D\u043E\u0432")) return true;
        if (t.includes("stop")) return true;
        if (t.includes("\u043E\u0441\u0442\u0430\u043D\u043E\u0432")) return true;
        return false;
      });
      for (const b of candidates) {
        if (isVisible(b)) return b;
      }
      return null;
    };
    const isDictationHotkey = (e) => e.code === "Space" && (e.ctrlKey || e.metaKey);
    const swallowKeyEvent = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
    };
    const isSafeToTriggerDictation = () => {
      const active = document.activeElement;
      const composerInput = findComposerInput2();
      if (!composerInput || !isElementVisible(composerInput)) return false;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLElement && active.isContentEditable) {
        if (active === composerInput) return true;
        if (composerInput instanceof HTMLElement && composerInput.contains(active)) return true;
        return false;
      }
      return true;
    };
    const isVoiceModeButton = (btn) => {
      if (!btn) return false;
      const dt = norm(btn.getAttribute("data-testid"));
      const aria = norm(btn.getAttribute("aria-label"));
      if (dt === "composer-speech-button") return true;
      if (aria.includes("voice mode")) return true;
      return false;
    };
    const isDictationButtonVisible = (btn) => {
      if (!btn) return false;
      if (btn.offsetParent === null) return false;
      return isElementVisible(btn);
    };
    const findDictationButtonsIn = (root) => {
      const found = [];
      const direct = Array.from(
        root.querySelectorAll(
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
        '[role="button"][aria-label*="\u0434\u0438\u043A\u0442\u043E\u0432" i]',
        '[role="button"][aria-label*="microphone" i]',
        '[role="button"][aria-label*="\u0433\u043E\u043B\u043E\u0441" i]',
        '[role="button"][aria-label*="voice" i]',
        'button[aria-label*="dictat" i]',
        'button[aria-label*="dictation" i]',
        'button[aria-label*="\u0434\u0438\u043A\u0442\u043E\u0432" i]',
        'button[aria-label*="microphone" i]',
        'button[aria-label*="\u0433\u043E\u043B\u043E\u0441" i]',
        'button[aria-label*="voice" i]'
      ];
      const candidates = Array.from(root.querySelectorAll(fallbackSelectors.join(",")));
      for (const btn of candidates) {
        if (found.includes(btn)) continue;
        if (isVoiceModeButton(btn)) continue;
        if (isDictationButtonVisible(btn)) found.push(btn);
      }
      return found;
    };
    const findDictationButtonIn = (root) => {
      const direct = root.querySelector(
        'button[aria-label="Dictate button"], [role="button"][aria-label="Dictate button"]'
      );
      if (direct && isDictationButtonVisible(direct) && !isVoiceModeButton(direct)) return direct;
      const fallbackSelectors = [
        '[role="button"][aria-label*="dictat" i]',
        '[role="button"][aria-label*="dictation" i]',
        '[role="button"][aria-label*="\u0434\u0438\u043A\u0442\u043E\u0432" i]',
        '[role="button"][aria-label*="microphone" i]',
        '[role="button"][aria-label*="\u0433\u043E\u043B\u043E\u0441" i]',
        '[role="button"][aria-label*="voice" i]',
        'button[aria-label*="dictat" i]',
        'button[aria-label*="dictation" i]',
        'button[aria-label*="\u0434\u0438\u043A\u0442\u043E\u0432" i]',
        'button[aria-label*="microphone" i]',
        'button[aria-label*="\u0433\u043E\u043B\u043E\u0441" i]',
        'button[aria-label*="voice" i]'
      ];
      const candidates = Array.from(root.querySelectorAll(fallbackSelectors.join(",")));
      for (const btn of candidates) {
        if (isVoiceModeButton(btn)) continue;
        if (isDictationButtonVisible(btn)) return btn;
      }
      return null;
    };
    const isDictationToggleButton = (btn) => {
      if (isVoiceModeButton(btn)) return false;
      const aria = norm(btn.getAttribute("aria-label"));
      const title = norm(btn.getAttribute("title"));
      const dt = norm(btn.getAttribute("data-testid"));
      if (aria === "dictate button") return true;
      if (aria.includes("dictat") || aria.includes("\u0434\u0438\u043A\u0442\u043E\u0432")) return true;
      if (aria.includes("microphone") || aria.includes("voice") || aria.includes("\u0433\u043E\u043B\u043E\u0441"))
        return true;
      if (title.includes("dictat") || title.includes("\u0434\u0438\u043A\u0442\u043E\u0432")) return true;
      if (title.includes("microphone") || title.includes("voice") || title.includes("\u0433\u043E\u043B\u043E\u0441"))
        return true;
      if (dt.includes("dictat") || dt.includes("dictation")) return true;
      if (dt.includes("microphone") || dt.includes("voice")) return true;
      return false;
    };
    const hasDictationButtonNearby = (btn) => {
      let p = btn.parentElement;
      for (let i = 0; i < 8 && p; i += 1) {
        const candidates = Array.from(p.querySelectorAll("button, [role='button']"));
        if (candidates.some((candidate) => isDictationToggleButton(candidate))) return true;
        p = p.parentElement;
      }
      return false;
    };
    const findDictationActionContainers = () => {
      const buttons = findDictationButtonsIn(document);
      const containers = /* @__PURE__ */ new Set();
      for (const btn of buttons) {
        let p = btn.parentElement;
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
    const isStopDictationButton = (btn) => {
      if (!btn) return false;
      const aria = norm(btn.getAttribute("aria-label"));
      const title = norm(btn.getAttribute("title"));
      const dt = norm(btn.getAttribute("data-testid"));
      const text = norm(btn.textContent);
      const hasStop = aria.includes("stop") || title.includes("stop") || text.includes("stop") || aria.includes("\u043E\u0441\u0442\u0430\u043D\u043E\u0432") || title.includes("\u043E\u0441\u0442\u0430\u043D\u043E\u0432") || text.includes("\u043E\u0441\u0442\u0430\u043D\u043E\u0432");
      if (!hasStop) return false;
      const hasDictation = aria.includes("dictation") || aria.includes("record") || title.includes("dictation") || title.includes("record") || text.includes("dictation") || text.includes("record") || aria.includes("\u0434\u0438\u043A\u0442\u043E\u0432") || title.includes("\u0434\u0438\u043A\u0442\u043E\u0432") || text.includes("\u0434\u0438\u043A\u0442\u043E\u0432") || dt.includes("dictation") || dt.includes("record");
      return hasDictation;
    };
    const findStopDictationButton = () => {
      const containers = findDictationActionContainers();
      const roots = containers.length > 0 ? containers : [document];
      for (const root of roots) {
        const btns = qsa("button, [role='button']", root);
        for (const b of btns) {
          if (!isStopDictationButton(b)) continue;
          if (!isVisible(b)) continue;
          return b;
        }
      }
      return null;
    };
    const findSubmitDictationButton = () => {
      const containers = findDictationActionContainers();
      const roots = containers.length > 0 ? containers : [document];
      for (const root of roots) {
        const btns = qsa("button, [role='button']", root);
        for (const b of btns) {
          if (!(b instanceof HTMLElement)) continue;
          if (b instanceof HTMLButtonElement) {
            const type = norm(b.getAttribute("type"));
            if (type === "submit") continue;
          }
          if (b === findSendButton2()) continue;
          if (!isSubmitDictationButton(b)) continue;
          if (isSendButton(b)) continue;
          if (!isVisible(b)) continue;
          return b;
        }
      }
      return null;
    };
    const getDictationUiState = () => {
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
    const waitForDictationButton = (timeoutMs = 1500) => new Promise((resolve) => {
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
      tmLog("dictation button found", { btn: describeEl2(btn) });
      btn.click();
      lastDictationToggleAt = performance.now();
      tmLog("dictation button clicked", { btn: describeEl2(btn) });
      return true;
    };
    const ensureNotGenerating = (timeoutMs) => new Promise((resolve) => {
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
    const stopGeneratingIfPossible = async (timeoutMs) => {
      const stopBtn = findStopGeneratingButton();
      if (!stopBtn) return true;
      tmLog("stop generating before send", { btn: describeEl2(stopBtn) });
      ctx.helpers.humanClick(stopBtn, "stop generating");
      const ok = await ensureNotGenerating(timeoutMs);
      if (!ok) {
        tmLog("stop generating timeout");
      }
      return ok;
    };
    const waitForFinalText = ({ snapshot, timeoutMs, quietMs }) => new Promise((resolve) => {
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
        const stableForMs = performance.now() - lastChangeAt | 0;
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
      const btn = findSendButton2();
      if (!btn) {
        tmLog("send button not found");
        return false;
      }
      if (isDisabled(btn)) {
        tmLog("send button disabled", { btn: describeEl2(btn) });
        return false;
      }
      ctx.helpers.humanClick(btn, "send");
      const t0 = performance.now();
      while (performance.now() - t0 <= cfg.sendAckTimeoutMs) {
        const cur2 = readInputText().text;
        const cleared = cur2.trim().length === 0;
        const stopGen = findStopGeneratingButton();
        const ack = cleared || !!stopGen;
        if (ack) {
          tmLog("ack ok", {
            ok: true,
            changed: cur2 !== before,
            len: cur2.length,
            preview: cur2
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
    const runAutoSendFlow = async (trigger, snapshotOverride, initialShiftHeld = false) => {
      if (inFlight) {
        tmLog("skip: inFlight already true", { reason: trigger });
        return;
      }
      inFlight = true;
      let cancelByShift = initialShiftHeld;
      const handleShiftKey = (event) => {
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
        const snapshot = snapshotOverride != null ? snapshotOverride : snap.text;
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
        const okGen = await stopGeneratingIfPossible(2e4);
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
          preview: String(e && e.stack || e.message || e)
        });
      } finally {
        window.removeEventListener("keydown", handleShiftKey, true);
        inFlight = false;
        tmLog("auto-send flow end", { reason: trigger });
      }
    };
    const injectPageTranscribeHook = () => {
      var _a, _b, _c;
      const runtime = (_c = (_a = globalThis.chrome) == null ? void 0 : _a.runtime) != null ? _c : (_b = globalThis.browser) == null ? void 0 : _b.runtime;
      if (!(runtime == null ? void 0 : runtime.getURL)) {
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
    const handleTranscribeMessage = (event) => {
      if (event.source !== window) return;
      const raw = event.data;
      if (!raw || typeof raw !== "object") return;
      const data = raw;
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
    const handleKeyDown = (e) => {
      if (!cfg.autoSendEnabled && !ctx.settings.startDictation) {
        return;
      }
      const submitDictationVisible = getDictationUiState() === "SUBMIT";
      if (e.key === "Shift" && submitDictationVisible) {
        lastShiftCancelAt = performance.now();
        tmLog("shift cancel recorded", { reason: "shift" });
      }
      if (e.code === "Space" && !e.ctrlKey && !e.metaKey && submitDictationVisible) {
        swallowKeyEvent(e);
        return;
      }
      if (submitDictationVisible && (e.ctrlKey || e.metaKey) && e.key === "Enter") {
        swallowKeyEvent(e);
        const submitBtn = findSubmitDictationButton();
        if (submitBtn) {
          tmLog("ctrl-enter: submit dictation", { btn: describeEl2(submitBtn) });
          ctx.helpers.humanClick(submitBtn, "submit-dictation");
        } else {
          tmLog("ctrl-enter: submit button not found", { reason: "ctrl-enter" });
        }
        return;
      }
      if (isDictationHotkey(e)) {
        tmLog("dictation hotkey received");
        log.info("hotkey", {
          startDictationEnabled: ctx.settings.startDictation,
          repeat: e.repeat,
          activeEl: document.activeElement ? {
            tag: document.activeElement.tagName,
            id: document.activeElement.id
          } : null
        });
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
        const submitBtn = findSubmitDictationButton();
        if (submitBtn) {
          tmLog("dictation submit via hotkey", { btn: describeEl2(submitBtn) });
          ctx.helpers.humanClick(submitBtn, "submit dictation via hotkey");
          return;
        }
        void triggerDictationToggle();
      }
    };
    const handleClick = (e) => {
      const target = e.target;
      const btn = target instanceof Element && target.closest ? target.closest("button, [role='button']") : null;
      if (!btn) return;
      const btnDesc = describeEl2(btn);
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
      if (btn instanceof HTMLElement && !isSubmitDictationButton(btn) && isDictationButtonVisible(btn) && isDictationToggleButton(btn)) {
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
    const findComposerFooter = () => document.querySelector('[data-testid="composer-footer-actions"]');
    const observeComposerFooter = () => {
      const footer = findComposerFooter();
      if (!footer) {
        tmLog("composer footer not found", { reason: "observe" });
        return;
      }
      if (composerFooterObserver && composerFooterNode === footer) return;
      composerFooterObserver == null ? void 0 : composerFooterObserver.disconnect();
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
    function handleStateObservation(reason) {
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
        composerFooterObserver == null ? void 0 : composerFooterObserver.disconnect();
        composerRootObserver == null ? void 0 : composerRootObserver.disconnect();
      },
      __test: {
        runAutoSendFlow: (snapshotOverride, initialShiftHeld) => runAutoSendFlow("test submit dictation", snapshotOverride, !!initialShiftHeld),
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

  // src/application/editLastMessageUseCases.ts
  function shouldTriggerArrowUpEdit({
    enabled,
    key,
    altKey,
    ctrlKey,
    metaKey,
    shiftKey,
    isComposing,
    inputText
  }) {
    if (!enabled) return false;
    if (key !== "ArrowUp") return false;
    if (isComposing) return false;
    if (altKey || ctrlKey || metaKey || shiftKey) return false;
    return (inputText || "").trim().length === 0;
  }

  // src/features/editLastMessage.ts
  function initEditLastMessageFeature(ctx) {
    const sleep2 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const qs = (sel, root = document) => root.querySelector(sel);
    const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    const isEditableElement = (el) => {
      if (!el) return false;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return true;
      if (el.getAttribute("contenteditable") === "true") return true;
      return !!el.closest('[contenteditable="true"]');
    };
    const findVisibleInput = (root) => {
      const candidates = qsa("input, textarea", root);
      for (const el of candidates) {
        if (el instanceof HTMLInputElement && el.type === "hidden") continue;
        if (isElementVisible(el)) return el;
      }
      return null;
    };
    const findRenameMenuItem = (menu) => {
      const preferred = menu.querySelector(
        'div[role="menuitem"][data-testid="rename-chat-menu-item"]'
      );
      if (preferred) return preferred;
      const items = qsa('[role="menuitem"]', menu);
      for (const item of items) {
        const text = norm(item.textContent);
        if (text.includes("rename") || text.includes("\u043F\u0435\u0440\u0435\u0438\u043C\u0435\u043D")) return item;
      }
      return null;
    };
    const waitForVisibleRadixMenu = async (timeoutMs = 2e3) => {
      const t0 = performance.now();
      while (performance.now() - t0 < timeoutMs) {
        const menus = qsa('[data-radix-menu-content][role="menu"]');
        for (const menu of menus) {
          if (isElementVisible(menu)) return menu;
        }
        await sleep2(25);
      }
      return null;
    };
    const waitForRenameInput = async (activeChat, timeoutMs = 2e3) => {
      var _a;
      const t0 = performance.now();
      while (performance.now() - t0 < timeoutMs) {
        const inChat = findVisibleInput(activeChat);
        if (inChat) return inChat;
        const dialogs = qsa('[role="dialog"]');
        const dialog = (_a = dialogs.find((el) => isElementVisible(el))) != null ? _a : null;
        if (dialog) {
          const dialogInput = findVisibleInput(dialog);
          if (dialogInput) return dialogInput;
        }
        await sleep2(25);
      }
      return null;
    };
    const logRenameStep = (step, ok) => {
      ctx.logger.debug("KEY", "rename chat", { step, ok });
    };
    const findActiveChat = () => {
      const selectors = [
        'a[data-sidebar-item="true"][data-active]',
        'a[data-sidebar-item="true"][aria-current="page"]',
        "a[data-active]",
        'nav[aria-label="Chat history"] a[aria-current="page"]'
      ];
      for (const selector of selectors) {
        const el = qs(selector);
        if (el) return el;
      }
      return null;
    };
    const findOptionsButton = (activeChat) => {
      var _a, _b, _c, _d, _e;
      const optionsSelector = 'button[data-testid^="history-item-"][data-testid$="-options"]';
      return (_e = (_d = (_b = activeChat.querySelector(optionsSelector)) != null ? _b : (_a = activeChat.parentElement) == null ? void 0 : _a.querySelector(optionsSelector)) != null ? _d : (_c = activeChat.closest("li, div")) == null ? void 0 : _c.querySelector(optionsSelector)) != null ? _e : null;
    };
    const triggerRenameActiveChat = async (activeChatOverride) => {
      const activeChat = activeChatOverride != null ? activeChatOverride : findActiveChat();
      if (!activeChat) {
        logRenameStep("activeChat not found", false);
        return false;
      }
      const optionsBtn = findOptionsButton(activeChat);
      if (!optionsBtn) {
        logRenameStep("optionsBtn not found", false);
        return false;
      }
      ctx.helpers.humanClick(optionsBtn, "open chat options");
      const menu = await waitForVisibleRadixMenu(2e3);
      if (!menu) {
        logRenameStep("menu not found", false);
        return false;
      }
      const renameItem = findRenameMenuItem(menu);
      if (!renameItem) {
        logRenameStep("renameItem not found", false);
        return false;
      }
      ctx.helpers.humanClick(renameItem, "rename chat");
      const input = await waitForRenameInput(activeChat, 2e3);
      if (!input) {
        logRenameStep("input not found", false);
        return false;
      }
      try {
        input.focus();
        if (typeof input.select === "function") input.select();
      } catch {
      }
      logRenameStep("ok", true);
      return true;
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
    const readTextboxText = (el) => {
      if (!el) return "";
      if (el instanceof HTMLTextAreaElement) return el.value || "";
      return String(el.innerText || el.textContent || "").replace(/\u00A0/g, " ");
    };
    const readInputText = () => {
      const el = findTextbox();
      if (!el) return { ok: false, kind: "none", text: "" };
      const kind = el instanceof HTMLTextAreaElement ? "textarea" : "contenteditable";
      return { ok: true, kind, text: readTextboxText(el) };
    };
    const isTextboxTarget = (target) => {
      if (!(target instanceof Node)) return false;
      const textbox = findTextbox();
      if (!textbox) return false;
      return target === textbox || textbox.contains(target);
    };
    const findLastUserMessage = () => {
      const candidates = qsa('[data-message-author-role="user"]');
      for (let i = candidates.length - 1; i >= 0; i -= 1) {
        const msg = candidates[i];
        if (isElementVisible(msg)) return msg;
      }
      return null;
    };
    const isEditMessageButton = (btn) => {
      if (!btn) return false;
      const a = norm(btn.getAttribute("aria-label"));
      const t = norm(btn.getAttribute("title"));
      const dt = norm(btn.getAttribute("data-testid"));
      const txt = norm(btn.textContent);
      if (dt.includes("edit")) return true;
      if (a.includes("edit") || a.includes("\u0440\u0435\u0434\u0430\u043A\u0442") || a.includes("\u0438\u0437\u043C\u0435\u043D")) return true;
      if (t.includes("edit") || t.includes("\u0440\u0435\u0434\u0430\u043A\u0442") || t.includes("\u0438\u0437\u043C\u0435\u043D")) return true;
      if (txt.includes("edit") || txt.includes("\u0440\u0435\u0434\u0430\u043A\u0442") || txt.includes("\u0438\u0437\u043C\u0435\u043D")) return true;
      return false;
    };
    const findEditInput = (root) => {
      const textarea = root.querySelector("textarea");
      if (textarea instanceof HTMLTextAreaElement && isElementVisible(textarea)) {
        return textarea;
      }
      const contentEditable = root.querySelector('[contenteditable="true"]');
      if (contentEditable instanceof HTMLElement && isElementVisible(contentEditable)) {
        return contentEditable;
      }
      return null;
    };
    const placeCursorAtEnd = (input) => {
      if (input instanceof HTMLTextAreaElement) {
        const end = input.value.length;
        input.selectionStart = end;
        input.selectionEnd = end;
        return;
      }
      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    };
    const waitForEditInput = async (message, timeoutMs = 2e3) => {
      const t0 = performance.now();
      while (performance.now() - t0 < timeoutMs) {
        const input = findEditInput(message);
        if (input) return input;
        await sleep2(50);
      }
      return null;
    };
    const triggerEditLastMessage = async () => {
      var _a, _b, _c;
      const message = findLastUserMessage();
      if (!message) return false;
      const article = (_b = (_a = message.closest("article")) != null ? _a : message.closest("[data-message-author-role]")) != null ? _b : message.parentElement;
      const searchRoot = article instanceof HTMLElement ? article : message;
      const buttons = qsa("button, [role='button']", searchRoot);
      const editBtn = (_c = buttons.find((btn) => {
        const a = norm(btn.getAttribute("aria-label"));
        if (a.includes("edit message")) return true;
        return isEditMessageButton(btn);
      })) != null ? _c : null;
      if (!editBtn) return false;
      message.scrollIntoView({ block: "center", inline: "nearest" });
      const clickOk = ctx.helpers.humanClick(editBtn, "edit last message");
      if (!clickOk) return false;
      const input = await waitForEditInput(searchRoot, 2e3);
      if (!input) return false;
      input.focus();
      placeCursorAtEnd(input);
      message.scrollIntoView({ block: "center" });
      return true;
    };
    const handleKeyDown = (e) => {
      if (e.key === "F2" && !e.repeat) {
        const targetEl = e.target instanceof Element ? e.target : null;
        const activeEl = document.activeElement instanceof Element ? document.activeElement : null;
        if (!isEditableElement(targetEl) && !isEditableElement(activeEl)) {
          const activeChat = findActiveChat();
          if (activeChat) {
            e.preventDefault();
            e.stopPropagation();
            void (async () => {
              await triggerRenameActiveChat(activeChat);
            })();
            return;
          }
        }
      }
      if (shouldTriggerArrowUpEdit({
        enabled: ctx.settings.editLastMessageOnArrowUp,
        key: e.key,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        isComposing: e.isComposing,
        inputText: readInputText().text
      }) && isTextboxTarget(e.target)) {
        void (async () => {
          const ok = await triggerEditLastMessage();
          ctx.logger.debug("KEY", "arrow up edit last message", { ok });
          if (ok) {
            e.preventDefault();
            e.stopPropagation();
          }
        })();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return {
      name: "editLastMessage",
      dispose: () => {
        window.removeEventListener("keydown", handleKeyDown, true);
      },
      getStatus: () => ({ active: ctx.settings.editLastMessageOnArrowUp })
    };
  }

  // src/features/oneClickDelete.ts
  var ONE_CLICK_DELETE_HOOK_MARK = "data-qqrm-oneclick-del-hooked";
  var ONE_CLICK_DELETE_ARCHIVE_MARK = "data-qqrm-oneclick-archive";
  var ONE_CLICK_DELETE_NATIVE_DOTS_MARK = "data-qqrm-native-dots";
  var ONE_CLICK_DELETE_X_MARK = "data-qqrm-oneclick-del-x";
  var ONE_CLICK_DELETE_STYLE_ID = "cgptbe-silent-delete-style";
  var ONE_CLICK_DELETE_ROOT_FLAG = "data-cgptbe-silent-delete";
  var ONE_CLICK_DELETE_BUTTON_SELECTOR = [
    // current/older sidebar patterns
    'button[data-testid^="history-item-"][data-testid$="-options"]',
    'button[data-testid$="-options"]',
    // some builds use only aria-labels
    'button[aria-label="Options"]',
    'button[aria-label*="More" i]',
    'button[aria-label*="Actions" i]'
  ].join(", ");
  var ONE_CLICK_DELETE_TOMBSTONES_KEY = "cgptbe-tombstones";
  var ONE_CLICK_DELETE_BTN_H = 36;
  var ONE_CLICK_DELETE_BTN_W = 118;
  var ONE_CLICK_DELETE_X_SIZE = 26;
  var ONE_CLICK_DELETE_X_RIGHT = 6;
  var ONE_CLICK_DELETE_GAP = 6;
  var ONE_CLICK_DELETE_ARCHIVE_SIZE = 26;
  var ONE_CLICK_DELETE_ARCHIVE_RIGHT = ONE_CLICK_DELETE_X_RIGHT + ONE_CLICK_DELETE_X_SIZE + ONE_CLICK_DELETE_GAP;
  var ONE_CLICK_DELETE_DOTS_LEFT = 10;
  var ONE_CLICK_DELETE_WIPE_MS = 4500;
  var ONE_CLICK_DELETE_UNDO_TOTAL_MS = 5e3;
  var ONE_CLICK_DELETE_TOOLTIP = "Click to delete";
  var ONE_CLICK_DELETE_ARCHIVE_TOOLTIP = "Archive";
  var CHAT_CONVERSATION_ID_REGEX = /\/c\/([^/?#]+)/;
  var readTombstones = () => {
    try {
      const raw = sessionStorage.getItem(ONE_CLICK_DELETE_TOMBSTONES_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((id) => typeof id === "string");
    } catch {
      return [];
    }
  };
  var writeTombstones = (ids) => {
    try {
      sessionStorage.setItem(ONE_CLICK_DELETE_TOMBSTONES_KEY, JSON.stringify(ids));
    } catch {
    }
  };
  var rememberTombstone = (conversationId) => {
    const existing = readTombstones();
    if (existing.includes(conversationId)) return;
    existing.push(conversationId);
    writeTombstones(existing);
  };
  var extractConversationIdFromRow = (row) => {
    var _a;
    if (!row) return null;
    const link = row.querySelector('a[href^="/c/"], a[href*="/c/"]');
    if (!link) return null;
    const href = (_a = link.getAttribute("href")) != null ? _a : "";
    const match = href.match(CHAT_CONVERSATION_ID_REGEX);
    return match ? match[1] : null;
  };
  var getAccessToken = async () => {
    try {
      const response = await fetch("/api/auth/session?unstable_client=true", {
        credentials: "include"
      });
      if (!response.ok) return null;
      const data = await response.json();
      if (data && typeof data.accessToken === "string") return data.accessToken;
      return null;
    } catch {
      return null;
    }
  };
  var patchConversation = async (conversationId, payload) => {
    try {
      const token = await getAccessToken();
      if (!token) return false;
      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      };
      const deviceId = localStorage.getItem("oai-device-id");
      if (deviceId) headers["oai-device-id"] = deviceId;
      const response = await fetch(`/backend-api/conversation/${conversationId}`, {
        method: "PATCH",
        credentials: "include",
        headers,
        body: JSON.stringify(payload)
      });
      return response.ok;
    } catch {
      return false;
    }
  };
  var directDeleteConversationFromRow = async (row) => {
    const conversationId = extractConversationIdFromRow(row);
    if (!conversationId) return { attempted: false, ok: false };
    const ok = await patchConversation(conversationId, { is_visible: false });
    if (ok) {
      rememberTombstone(conversationId);
      if (row.isConnected) row.remove();
    }
    return { attempted: true, ok };
  };
  var directArchiveConversationFromRow = async (row) => {
    const conversationId = extractConversationIdFromRow(row);
    if (!conversationId) return { attempted: false, ok: false };
    const ok = await patchConversation(conversationId, { is_archived: true });
    if (ok) {
      rememberTombstone(conversationId);
      if (row.isConnected) row.remove();
    }
    return { attempted: true, ok };
  };
  var buildOneClickDeleteStyleText = () => `
  html{
    --qqrm-danger: #d13b3b;
    --qqrm-danger-bg: rgba(209, 59, 59, 0.14);
    --qqrm-danger-border: rgba(209, 59, 59, 0.35);
    --qqrm-danger-muted: #6b7280;
    --qqrm-danger-muted-bg: rgba(107, 114, 128, 0.1);
    --qqrm-danger-muted-border: rgba(107, 114, 128, 0.28);
    --qqrm-archive: #2563eb;
    --qqrm-archive-bg: rgba(37, 99, 235, 0.14);
    --qqrm-archive-border: rgba(37, 99, 235, 0.35);
    --qqrm-archive-muted: #6b7280;
    --qqrm-archive-muted-bg: rgba(107, 114, 128, 0.1);
    --qqrm-archive-muted-border: rgba(107, 114, 128, 0.28);
  }

  @media (prefers-color-scheme: dark) {
    html{
      --qqrm-danger: #f87171;
      --qqrm-danger-bg: rgba(248, 113, 113, 0.16);
      --qqrm-danger-border: rgba(248, 113, 113, 0.35);
      --qqrm-danger-muted: #9ca3af;
      --qqrm-danger-muted-bg: rgba(148, 163, 184, 0.14);
      --qqrm-danger-muted-border: rgba(148, 163, 184, 0.3);
      --qqrm-archive: #60a5fa;
      --qqrm-archive-bg: rgba(96, 165, 250, 0.16);
      --qqrm-archive-border: rgba(96, 165, 250, 0.35);
      --qqrm-archive-muted: #9ca3af;
      --qqrm-archive-muted-bg: rgba(148, 163, 184, 0.14);
      --qqrm-archive-muted-border: rgba(148, 163, 184, 0.3);
    }
  }

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

  ${ONE_CLICK_DELETE_BUTTON_SELECTOR} svg[${ONE_CLICK_DELETE_NATIVE_DOTS_MARK}="1"]{
    position: absolute !important;
    left: ${ONE_CLICK_DELETE_DOTS_LEFT}px !important;
    top: 50% !important;
    transform: translateY(-50%) !important;
    pointer-events: none !important;
  }

  ${ONE_CLICK_DELETE_BUTTON_SELECTOR} > span[${ONE_CLICK_DELETE_ARCHIVE_MARK}="1"]{
    position: absolute;
    right: ${ONE_CLICK_DELETE_ARCHIVE_RIGHT}px;
    top: 50%;
    transform: translate3d(0, -50%, 0);
    width: ${ONE_CLICK_DELETE_ARCHIVE_SIZE}px;
    height: ${ONE_CLICK_DELETE_ARCHIVE_SIZE}px;
    border-radius: 9px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    font-weight: 600;
    line-height: 18px;
    color: var(--qqrm-archive-muted, #6b7280);
    background: var(--qqrm-archive-muted-bg, rgba(107, 114, 128, 0.1));
    border: 1px solid var(--qqrm-archive-muted-border, rgba(107, 114, 128, 0.28));
    box-shadow: -1px 0 0 rgba(255, 255, 255, 0.08) inset;
    opacity: 0.0;
    will-change: opacity, transform;
    transition: opacity 140ms ease, background 140ms ease;
    user-select: none;
    pointer-events: auto;
    cursor: pointer;
  }

  ${ONE_CLICK_DELETE_BUTTON_SELECTOR} > span[${ONE_CLICK_DELETE_ARCHIVE_MARK}="1"] svg{
    display: block;
  }

  ${ONE_CLICK_DELETE_BUTTON_SELECTOR} > span[${ONE_CLICK_DELETE_X_MARK}="1"]{
    position: absolute;
    right: ${ONE_CLICK_DELETE_X_RIGHT}px;
    top: 50%;
    transform: translate3d(0, -50%, 0);
    width: ${ONE_CLICK_DELETE_X_SIZE}px;
    height: ${ONE_CLICK_DELETE_X_SIZE}px;
    border-radius: 9px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: 600;
    line-height: 18px;
    color: var(--qqrm-danger-muted, #6b7280);
    background: var(--qqrm-danger-muted-bg, rgba(107, 114, 128, 0.1));
    border: 1px solid var(--qqrm-danger-muted-border, rgba(107, 114, 128, 0.28));
    box-shadow: -1px 0 0 rgba(255, 255, 255, 0.08) inset;
    opacity: 0.0;
    will-change: opacity, transform;
    transition: opacity 140ms ease, background 140ms ease;
    user-select: none;
    pointer-events: auto;
    cursor: pointer;
  }

  ${ONE_CLICK_DELETE_BUTTON_SELECTOR} > span[${ONE_CLICK_DELETE_X_MARK}="1"] svg{
    display: block;
  }

  ${ONE_CLICK_DELETE_BUTTON_SELECTOR} > span[${ONE_CLICK_DELETE_X_MARK}="1"]::after{
    content: "${ONE_CLICK_DELETE_TOOLTIP}";
    position: absolute;
    right: 0;
    top: -8px;
    transform: translateY(-100%);
    white-space: nowrap;
    font-size: 12px;
    line-height: 16px;
    padding: 6px 8px;
    border-radius: 8px;
    color: var(--text-primary, #e5e7eb);
    background: rgba(17, 24, 39, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.10);
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease, transform 120ms ease;
    z-index: 99999;
  }

  ${ONE_CLICK_DELETE_BUTTON_SELECTOR} > span[${ONE_CLICK_DELETE_X_MARK}="1"]:hover::after{
    opacity: 1;
    transform: translateY(-110%);
  }

  ${ONE_CLICK_DELETE_BUTTON_SELECTOR}:hover > span[${ONE_CLICK_DELETE_ARCHIVE_MARK}="1"],
  ${ONE_CLICK_DELETE_BUTTON_SELECTOR}:focus-visible > span[${ONE_CLICK_DELETE_ARCHIVE_MARK}="1"]{
    opacity: 1.0;
    color: var(--qqrm-archive, #2563eb);
    background: var(--qqrm-archive-bg, rgba(37, 99, 235, 0.18));
    border-color: var(--qqrm-archive-border, rgba(37, 99, 235, 0.35));
    transform: translate3d(0, -50%, 0);
  }

  ${ONE_CLICK_DELETE_BUTTON_SELECTOR}:hover > span[${ONE_CLICK_DELETE_X_MARK}="1"],
  ${ONE_CLICK_DELETE_BUTTON_SELECTOR}:focus-visible > span[${ONE_CLICK_DELETE_X_MARK}="1"]{
    opacity: 1.0;
    color: var(--qqrm-danger, #d13b3b);
    background: var(--qqrm-danger-bg, rgba(209, 59, 59, 0.18));
    border-color: var(--qqrm-danger-border, rgba(209, 59, 59, 0.35));
    transform: translate3d(0, -50%, 0);
  }

  html[${ONE_CLICK_DELETE_ROOT_FLAG}="1"] div[data-testid="modal-delete-conversation-confirmation"]{
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
  }
  html[${ONE_CLICK_DELETE_ROOT_FLAG}="1"] [role="menu"]{
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
  }
  html[${ONE_CLICK_DELETE_ROOT_FLAG}="1"] [data-radix-popper-content-wrapper]{
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
  }
  html[${ONE_CLICK_DELETE_ROOT_FLAG}="1"] *{
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }

  .group.__menu-item.hoverable.qqrm-oneclick-pending{
    position: relative !important;
  }

  .group.__menu-item.hoverable.qqrm-oneclick-pending > *:not(.qqrm-oneclick-undo-overlay){
    opacity: 0.28 !important;
  }

  .group.__menu-item.hoverable .qqrm-oneclick-undo-overlay{
    position: absolute;
    inset: 0;
    border-radius: var(--qqrm-row-radius, 14px);
    overflow: hidden;

    --qqrm-wipe-a: rgba(239,68,68,0.26);
    --qqrm-wipe-b: rgba(185,28,28,0.34);
    --qqrm-heat-1: rgba(255, 180, 60, 0.14);
    --qqrm-heat-2: rgba(239, 68, 68, 0.12);
    --qqrm-heat-3: rgba(255, 220, 120, 0.10);

    z-index: 999;

    display: grid;
    place-items: center;

    cursor: pointer;
    user-select: none;

    background: rgba(0,0,0,0.10);
    border: 1px solid rgba(255,255,255,0.08);
    backdrop-filter: blur(1.5px);
  }

  .group.__menu-item.hoverable .qqrm-oneclick-undo-overlay.qqrm-archive{
    --qqrm-wipe-a: rgba(59,130,246,0.22);
    --qqrm-wipe-b: rgba(37,99,235,0.32);
    --qqrm-heat-1: rgba(96,165,250,0.16);
    --qqrm-heat-2: rgba(59,130,246,0.14);
    --qqrm-heat-3: rgba(147,197,253,0.12);
  }

  .group.__menu-item.hoverable .qqrm-oneclick-wipe{
    position: absolute;
    inset: 0;
    border-radius: var(--qqrm-row-radius, 14px);
    overflow: hidden;

    z-index: 1;
    pointer-events: none;
  }

  .group.__menu-item.hoverable .qqrm-oneclick-wipe::before{
    content: "";
    position: absolute;
    inset: 0;

    background:
      linear-gradient(90deg,
        var(--qqrm-wipe-a, rgba(239,68,68,0.26)),
        var(--qqrm-wipe-b, rgba(185,28,28,0.34))
      ),
      radial-gradient(circle at 70% 50%, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 60%);

    transform-origin: right center;
    animation: qqrmOneClickWipeCover var(--qqrm-wipe-ms, 4500ms) linear forwards;
  }

  @keyframes qqrmOneClickWipeCover{
    from { transform: scaleX(0); }
    to   { transform: scaleX(1); }
  }

  .group.__menu-item.hoverable .qqrm-oneclick-heat{
    position: absolute;
    inset: 0;
    border-radius: var(--qqrm-row-radius, 14px);
    overflow: hidden;

    z-index: 2;
    pointer-events: none;

    opacity: 0.75;
    mix-blend-mode: screen;
  }

  .group.__menu-item.hoverable .qqrm-oneclick-heat::before{
    content: "";
    position: absolute;
    inset: -35% -35% -35% -35%;

    background:
      radial-gradient(circle at 30% 70%, var(--qqrm-heat-1, rgba(255, 180, 60, 0.14)) 0%, rgba(255, 180, 60, 0) 62%),
      radial-gradient(circle at 55% 90%, var(--qqrm-heat-2, rgba(239, 68, 68, 0.12)) 0%, rgba(239, 68, 68, 0) 68%),
      radial-gradient(circle at 75% 55%, var(--qqrm-heat-3, rgba(255, 220, 120, 0.10)) 0%, rgba(255, 220, 120, 0) 66%);

    filter: blur(12px);
    animation: qqrmOneClickHeatMove 520ms ease-in-out infinite alternate;
  }

  @keyframes qqrmOneClickHeatMove{
    from { transform: translate3d(-1.2%, 0.8%, 0) scale(1.02); opacity: 0.55; }
    to   { transform: translate3d( 1.2%, -0.8%, 0) scale(1.05); opacity: 0.85; }
  }

  .group.__menu-item.hoverable .qqrm-oneclick-undo-label{
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);

    z-index: 3;
    pointer-events: none;

    font-family: var(--qqrm-row-font-family, inherit);
    font-size: var(--qqrm-row-font-size, 13px);
    font-weight: var(--qqrm-row-font-weight, 600);
    line-height: var(--qqrm-row-line-height, 18px);
    letter-spacing: var(--qqrm-row-letter-spacing, normal);

    color: var(--text-primary, #e5e7eb);
    text-shadow: 0 2px 12px rgba(0,0,0,0.35);

    opacity: 0;
    animation: qqrmUndoIn 180ms ease forwards;
    animation-delay: 0ms;
  }

  @keyframes qqrmUndoIn{
    from{ opacity: 0; transform: translate(-50%, -50%) translateY(1px); }
    to{ opacity: 1; transform: translate(-50%, -50%) translateY(0); }
  }
`;
  function initOneClickDeleteFeature(ctx) {
    const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    const state = {
      started: false,
      observer: null,
      tombstoneObserver: null,
      intervalId: null,
      pendingByRow: /* @__PURE__ */ new Map(),
      deleteQueue: Promise.resolve(),
      tombstoneRoot: null
    };
    const enqueueDelete = (job) => {
      state.deleteQueue = state.deleteQueue.then(job).catch(() => {
      });
    };
    const waitPresent = async (selector, root = document, timeoutMs = 1200) => {
      const t0 = performance.now();
      while (performance.now() - t0 < timeoutMs) {
        const el = root.querySelector(selector);
        if (el) return el;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return null;
    };
    const findButtonByExactText = (root, text) => {
      var _a;
      const candidates = Array.from(root.querySelectorAll('button, [role="menuitem"]'));
      return (_a = candidates.find((el) => {
        var _a2;
        return ((_a2 = el.textContent) == null ? void 0 : _a2.trim()) === text;
      })) != null ? _a : candidates.find((el) => {
        var _a2;
        return ((_a2 = el.textContent) == null ? void 0 : _a2.trim().toLowerCase()) === text.toLowerCase();
      });
    };
    const findButtonByTextVariants = (root, variants) => {
      for (const variant of variants) {
        const match = findButtonByExactText(root, variant);
        if (match) return match;
      }
      return null;
    };
    const setSilentDeleteMode = (on) => {
      if (on) document.documentElement.setAttribute(ONE_CLICK_DELETE_ROOT_FLAG, "1");
      else document.documentElement.removeAttribute(ONE_CLICK_DELETE_ROOT_FLAG);
    };
    const logDebug = (message) => {
      if (ctx.logger.isEnabled) ctx.logger.debug("oneClickDelete", message);
    };
    const ensureOneClickDeleteStyle = () => {
      var _a;
      if (document.getElementById(ONE_CLICK_DELETE_STYLE_ID)) return;
      const st = document.createElement("style");
      st.id = ONE_CLICK_DELETE_STYLE_ID;
      st.textContent = buildOneClickDeleteStyleText();
      const host = (_a = document.head) != null ? _a : document.documentElement;
      if (!host) return;
      host.appendChild(st);
    };
    const removeOneClickDeleteStyle = () => {
      const st = document.getElementById(ONE_CLICK_DELETE_STYLE_ID);
      if (st) st.remove();
    };
    const ensureOneClickDeleteXSpan = (btn) => {
      let x = btn.querySelector(`span[${ONE_CLICK_DELETE_X_MARK}="1"]`);
      if (x) return x;
      x = document.createElement("span");
      x.setAttribute(ONE_CLICK_DELETE_X_MARK, "1");
      x.setAttribute("aria-label", ONE_CLICK_DELETE_TOOLTIP);
      x.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M18 6L6 18M6 6l12 12"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
        />
      </svg>
    `;
      btn.appendChild(x);
      return x;
    };
    const ensureOneClickArchiveSpan = (btn) => {
      let archive = btn.querySelector(`span[${ONE_CLICK_DELETE_ARCHIVE_MARK}="1"]`);
      if (archive) return archive;
      archive = document.createElement("span");
      archive.setAttribute(ONE_CLICK_DELETE_ARCHIVE_MARK, "1");
      archive.setAttribute("aria-label", ONE_CLICK_DELETE_ARCHIVE_TOOLTIP);
      archive.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 3v10m0 0l4-4m-4 4l-4-4"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M4 17v3h16v-3"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    `;
      btn.appendChild(archive);
      return archive;
    };
    const ensureNativeDotsMark = (btn) => {
      const svgs = Array.from(btn.querySelectorAll("svg"));
      const native = svgs.find(
        (svg) => !svg.closest(`span[${ONE_CLICK_DELETE_X_MARK}="1"]`) && !svg.closest(`span[${ONE_CLICK_DELETE_ARCHIVE_MARK}="1"]`)
      );
      if (native) native.setAttribute(ONE_CLICK_DELETE_NATIVE_DOTS_MARK, "1");
    };
    const clearOneClickDeleteButtons = () => {
      const btns = qsa(ONE_CLICK_DELETE_BUTTON_SELECTOR);
      for (const btn of btns) {
        btn.removeAttribute(ONE_CLICK_DELETE_HOOK_MARK);
        const x = btn.querySelector(`span[${ONE_CLICK_DELETE_X_MARK}="1"]`);
        if (x) x.remove();
        const archive = btn.querySelector(`span[${ONE_CLICK_DELETE_ARCHIVE_MARK}="1"]`);
        if (archive) archive.remove();
        const dots = btn.querySelector(`svg[${ONE_CLICK_DELETE_NATIVE_DOTS_MARK}="1"]`);
        if (dots) dots.removeAttribute(ONE_CLICK_DELETE_NATIVE_DOTS_MARK);
      }
    };
    const swallowEvent = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof ev.stopImmediatePropagation === "function") {
        ev.stopImmediatePropagation();
      }
    };
    const findChatRowFromOptionsButton = (btn) => {
      var _a, _b, _c, _d, _e;
      const row = (_e = (_d = (_b = (_a = btn.closest(".group.__menu-item.hoverable")) != null ? _a : btn.closest('[data-testid^="history-item-"]')) != null ? _b : btn.closest("li")) != null ? _d : (_c = btn.closest("a[href^='/c/']")) == null ? void 0 : _c.parentElement) != null ? _e : null;
      return row;
    };
    const removeTombstonedRows = (root = document) => {
      const tombstones = new Set(readTombstones());
      if (tombstones.size === 0) return;
      const rows = qsa(
        [".group.__menu-item.hoverable", '[data-testid^="history-item-"]', "nav a[href^='/c/']"].join(
          ", "
        ),
        root
      );
      for (const row of rows) {
        const conversationId = extractConversationIdFromRow(row);
        if (conversationId && tombstones.has(conversationId) && row.isConnected) {
          row.remove();
        }
      }
    };
    const findChatListRoot = () => {
      const row = document.querySelector(
        [".group.__menu-item.hoverable", '[data-testid^="history-item-"]', "nav a[href^='/c/']"].join(
          ", "
        )
      );
      if (row == null ? void 0 : row.parentElement) return row.parentElement;
      const nav = document.querySelector('nav[aria-label*="chat" i]');
      if (nav) return nav;
      return document.body;
    };
    const ensureTombstoneObserver = () => {
      var _a;
      const root = findChatListRoot();
      if (root === state.tombstoneRoot && state.tombstoneObserver) return;
      (_a = state.tombstoneObserver) == null ? void 0 : _a.disconnect();
      state.tombstoneRoot = root;
      state.tombstoneObserver = new MutationObserver(() => removeTombstonedRows(root));
      state.tombstoneObserver.observe(root, { childList: true, subtree: true });
      removeTombstonedRows(root);
    };
    const applyRowTypographyVars = (row) => {
      try {
        const titleSpan = row.querySelector('.truncate span[dir="auto"]');
        if (titleSpan) {
          const cs = window.getComputedStyle(titleSpan);
          row.style.setProperty("--qqrm-row-font-family", cs.fontFamily);
          row.style.setProperty("--qqrm-row-font-size", cs.fontSize);
          row.style.setProperty("--qqrm-row-font-weight", cs.fontWeight);
          row.style.setProperty("--qqrm-row-line-height", cs.lineHeight);
          row.style.setProperty("--qqrm-row-letter-spacing", cs.letterSpacing);
        }
        const pickNativeRowBorderRadius = () => {
          const candidates = [row];
          const first = row.firstElementChild;
          if (first instanceof HTMLElement) candidates.push(first);
          const inner = row.querySelector("a, button, [role='button'], div");
          if (inner) candidates.push(inner);
          for (const el of candidates) {
            const br = window.getComputedStyle(el).borderRadius;
            const n = Number.parseFloat(br || "0");
            if (Number.isFinite(n) && n > 0.5) return br;
          }
          return "14px";
        };
        row.style.setProperty("--qqrm-row-radius", pickNativeRowBorderRadius());
      } catch {
      }
    };
    const clearPendingActionForRow = (row) => {
      const pending = state.pendingByRow.get(row);
      if (!pending) return;
      window.clearTimeout(pending.timerId);
      if (pending.overlay.isConnected) pending.overlay.remove();
      if (pending.row.isConnected) pending.row.classList.remove("qqrm-oneclick-pending");
      state.pendingByRow.delete(row);
    };
    const clearAllPendingActions = () => {
      for (const row of Array.from(state.pendingByRow.keys())) {
        clearPendingActionForRow(row);
      }
    };
    const cleanupDetachedPendingRows = () => {
      for (const [row] of Array.from(state.pendingByRow.entries())) {
        if (!row.isConnected) {
          state.pendingByRow.delete(row);
        }
      }
    };
    const createPendingOverlay = (row, kind) => {
      const overlay = document.createElement("div");
      overlay.className = "qqrm-oneclick-undo-overlay";
      if (kind === "archive") {
        overlay.classList.add("qqrm-archive");
      }
      overlay.style.setProperty("--qqrm-wipe-ms", `${ONE_CLICK_DELETE_WIPE_MS}ms`);
      overlay.innerHTML = `
    <div class="qqrm-oneclick-wipe"></div>
    <div class="qqrm-oneclick-heat"></div>
    <div class="qqrm-oneclick-undo-label">Undo</div>
  `;
      overlay.addEventListener(
        "pointerdown",
        (ev) => {
          swallowEvent(ev);
        },
        true
      );
      overlay.addEventListener(
        "click",
        (ev) => {
          swallowEvent(ev);
          clearPendingActionForRow(row);
        },
        true
      );
      row.appendChild(overlay);
      return overlay;
    };
    const runPendingAction = (kind, optionsBtn) => {
      if (kind === "archive") return runOneClickArchiveFlow(optionsBtn);
      return runOneClickDeleteFlow(optionsBtn);
    };
    const startPendingAction = (optionsBtn, kind) => {
      const row = findChatRowFromOptionsButton(optionsBtn);
      if (!row) {
        enqueueDelete(() => runPendingAction(kind, optionsBtn));
        return;
      }
      applyRowTypographyVars(row);
      if (state.pendingByRow.has(row)) {
        clearPendingActionForRow(row);
      }
      row.classList.add("qqrm-oneclick-pending");
      const overlay = createPendingOverlay(row, kind);
      const timerId = window.setTimeout(() => {
        clearPendingActionForRow(row);
        enqueueDelete(() => runPendingAction(kind, optionsBtn));
      }, ONE_CLICK_DELETE_UNDO_TOTAL_MS);
      state.pendingByRow.set(row, {
        timerId,
        row,
        overlay,
        optionsBtn,
        kind
      });
    };
    const startPendingDelete = (optionsBtn) => {
      startPendingAction(optionsBtn, "delete");
    };
    const startPendingArchive = (optionsBtn) => {
      startPendingAction(optionsBtn, "archive");
    };
    const getDeleteXFromEvent = (target) => {
      if (!(target instanceof Element)) return null;
      return target.closest(`span[${ONE_CLICK_DELETE_X_MARK}="1"]`);
    };
    const getArchiveFromEvent = (target) => {
      if (!(target instanceof Element)) return null;
      return target.closest(`span[${ONE_CLICK_DELETE_ARCHIVE_MARK}="1"]`);
    };
    const getDeleteButtonFromX = (x) => x.closest(ONE_CLICK_DELETE_BUTTON_SELECTOR);
    const getOptionsButtonFromArchive = (archive) => archive.closest(ONE_CLICK_DELETE_BUTTON_SELECTOR);
    const hookOneClickDeleteButton = (btn) => {
      if (!btn || btn.nodeType !== 1) return;
      if (btn.hasAttribute(ONE_CLICK_DELETE_HOOK_MARK)) return;
      btn.setAttribute(ONE_CLICK_DELETE_HOOK_MARK, "1");
      ensureOneClickDeleteXSpan(btn);
      ensureOneClickArchiveSpan(btn);
      ensureNativeDotsMark(btn);
    };
    const runOneClickDeleteUiFlow = async (btn) => {
      var _a, _b;
      try {
        setSilentDeleteMode(true);
        ctx.helpers.humanClick(btn, "oneclick-delete-open-menu");
        const deleteItem = await (async () => {
          var _a2, _b2;
          const t0 = performance.now();
          while (performance.now() - t0 < 1500) {
            const menus = qsa('[role="menu"]');
            for (const menu of menus) {
              const item = (_a2 = menu.querySelector(
                'div[role="menuitem"][data-testid="delete-chat-menu-item"]'
              )) != null ? _a2 : findButtonByExactText(menu, "Delete");
              if (item) return item;
            }
            const fallback = (_b2 = document.querySelector(
              'div[role="menuitem"][data-testid="delete-chat-menu-item"]'
            )) != null ? _b2 : findButtonByExactText(document, "Delete");
            if (fallback) return fallback;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return null;
        })();
        if (!deleteItem) return;
        ctx.helpers.humanClick(deleteItem, "oneclick-delete-menu");
        const modal = await waitPresent(
          'div[data-testid="modal-delete-conversation-confirmation"]',
          document,
          1500
        );
        if (!modal) return;
        const confirmBtn = (_b = (_a = modal.querySelector(
          'button[data-testid="delete-conversation-confirm-button"]'
        )) != null ? _a : await waitPresent(
          'button[data-testid="delete-conversation-confirm-button"]',
          modal,
          1200
        )) != null ? _b : findButtonByExactText(modal, "Delete");
        if (!confirmBtn) return;
        ctx.helpers.humanClick(confirmBtn, "oneclick-delete-confirm");
      } finally {
        await new Promise((resolve) => setTimeout(resolve, 120));
        setSilentDeleteMode(false);
      }
    };
    const runOneClickArchiveUiFlow = async (btn) => {
      var _a, _b;
      try {
        setSilentDeleteMode(true);
        ctx.helpers.humanClick(btn, "oneclick-archive-open-menu");
        const archiveItem = await (async () => {
          const archiveTextVariants = [
            "Archive",
            "Archive chat",
            "Move to archive",
            "\u0410\u0440\u0445\u0438\u0432",
            "\u0410\u0440\u0445\u0438\u0432\u0438\u0440\u043E\u0432\u0430\u0442\u044C"
          ];
          const archiveSelectors = [
            'div[role="menuitem"][data-testid="archive-chat-menu-item"]',
            'div[role="menuitem"][data-testid="archive-chat-menuitem"]',
            'div[role="menuitem"][data-testid*="archive" i]'
          ];
          const t0 = performance.now();
          while (performance.now() - t0 < 1500) {
            const menus = qsa('[role="menu"]');
            for (const menu of menus) {
              for (const selector of archiveSelectors) {
                const item = menu.querySelector(selector);
                if (item) return item;
              }
              const byText = findButtonByTextVariants(menu, archiveTextVariants);
              if (byText) return byText;
            }
            for (const selector of archiveSelectors) {
              const fallback = document.querySelector(selector);
              if (fallback) return fallback;
            }
            const fallbackText = findButtonByTextVariants(document, archiveTextVariants);
            if (fallbackText) return fallbackText;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return null;
        })();
        if (!archiveItem) return;
        ctx.helpers.humanClick(archiveItem, "oneclick-archive-menu");
        const modal = await waitPresent(
          '[role="dialog"], [role="alertdialog"]',
          document,
          1200
        );
        if (!modal) return;
        const confirmTexts = [
          "Archive",
          "Move to archive",
          "Confirm",
          "Yes",
          "OK",
          "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C",
          "\u041F\u0440\u0438\u043C\u0435\u043D\u0438\u0442\u044C",
          "\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C"
        ];
        const confirmBtn = (_b = (_a = modal.querySelector('button[data-testid*="confirm" i]')) != null ? _a : modal.querySelector('button[data-testid*="archive" i]')) != null ? _b : findButtonByTextVariants(modal, confirmTexts);
        if (!confirmBtn) return;
        ctx.helpers.humanClick(confirmBtn, "oneclick-archive-confirm");
      } finally {
        await new Promise((resolve) => setTimeout(resolve, 120));
        setSilentDeleteMode(false);
      }
    };
    const runOneClickDeleteFlow = async (btn) => {
      const row = findChatRowFromOptionsButton(btn);
      if (!row) return;
      const directResult = await directDeleteConversationFromRow(row);
      if (directResult.ok) {
        logDebug("direct delete patch ok");
        return;
      }
      if (directResult.attempted) {
        logDebug("direct patch failed, fallback to UI");
      }
      await runOneClickDeleteUiFlow(btn);
    };
    const runOneClickArchiveFlow = async (btn) => {
      const row = findChatRowFromOptionsButton(btn);
      if (!row) return;
      const directResult = await directArchiveConversationFromRow(row);
      if (directResult.ok) {
        logDebug("direct archive patch ok");
        return;
      }
      if (directResult.attempted) {
        logDebug("direct patch failed, fallback to UI");
      }
      await runOneClickArchiveUiFlow(btn);
    };
    const handlePointerDown = (ev) => {
      const archive = getArchiveFromEvent(ev.target);
      if (archive) {
        const btn2 = getOptionsButtonFromArchive(archive);
        if (!btn2) return;
        swallowEvent(ev);
        startPendingArchive(btn2);
        return;
      }
      const x = getDeleteXFromEvent(ev.target);
      if (!x) return;
      const btn = getDeleteButtonFromX(x);
      if (!btn) return;
      swallowEvent(ev);
      startPendingDelete(btn);
    };
    const handleClick = (ev) => {
      const archive = getArchiveFromEvent(ev.target);
      if (archive) {
        swallowEvent(ev);
        return;
      }
      const x = getDeleteXFromEvent(ev.target);
      if (!x) return;
      swallowEvent(ev);
    };
    const handleBlur = () => {
    };
    const refreshOneClickDelete = () => {
      if (!ctx.settings.oneClickDelete) return;
      ensureOneClickDeleteStyle();
      const btns = qsa(ONE_CLICK_DELETE_BUTTON_SELECTOR);
      for (const btn of btns) hookOneClickDeleteButton(btn);
      cleanupDetachedPendingRows();
      ensureTombstoneObserver();
    };
    const startOneClickDelete = () => {
      if (state.started) return;
      state.started = true;
      document.addEventListener("pointerdown", handlePointerDown, true);
      document.addEventListener("click", handleClick, true);
      window.addEventListener("blur", handleBlur, true);
      refreshOneClickDelete();
      state.intervalId = window.setInterval(refreshOneClickDelete, 1200);
      state.observer = new MutationObserver(() => refreshOneClickDelete());
      state.observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    };
    const stopOneClickDelete = () => {
      if (!state.started) return;
      state.started = false;
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("blur", handleBlur, true);
      clearAllPendingActions();
      if (state.intervalId !== null) {
        window.clearInterval(state.intervalId);
        state.intervalId = null;
      }
      if (state.observer) {
        state.observer.disconnect();
        state.observer = null;
      }
      if (state.tombstoneObserver) {
        state.tombstoneObserver.disconnect();
        state.tombstoneObserver = null;
      }
      state.tombstoneRoot = null;
      clearOneClickDeleteButtons();
      removeOneClickDeleteStyle();
      setSilentDeleteMode(false);
    };
    if (ctx.settings.oneClickDelete) startOneClickDelete();
    return {
      name: "oneClickDelete",
      dispose: () => {
        stopOneClickDelete();
      },
      onSettingsChange: (next, prev) => {
        if (!prev.oneClickDelete && next.oneClickDelete) startOneClickDelete();
        if (prev.oneClickDelete && !next.oneClickDelete) stopOneClickDelete();
      },
      getStatus: () => ({ active: ctx.settings.oneClickDelete })
    };
  }

  // src/features/autoTempChat.ts
  var TEMP_CHAT_CHECKBOX_SELECTOR = "#temporary-chat-checkbox";
  var TEMP_CHAT_LABEL_SELECTOR = 'h1[data-testid="temporary-chat-label"]';
  var TEMP_CHAT_TOGGLE_BUTTON_SELECTOR = 'button[aria-label*="temporary chat" i]';
  var NAVIGATION_EVENT_NAME = "qqrm:navigation";
  var NAVIGATION_FALLBACK_DELAY_MS = 1e4;
  var NAVIGATION_FALLBACK_INTERVAL_MS = 2500;
  function initAutoTempChatFeature(ctx) {
    const state = {
      started: false,
      observer: null,
      lastPath: "",
      domReady: document.readyState !== "loading",
      lastNavigationEventAt: Date.now(),
      fallbackTimeoutId: null,
      fallbackIntervalId: null,
      historyPatched: false,
      originalPushState: null,
      originalReplaceState: null
    };
    const getTempChatCheckbox = () => document.querySelector(TEMP_CHAT_CHECKBOX_SELECTOR);
    const getTempChatToggleButton = () => {
      const btn = document.querySelector(TEMP_CHAT_TOGGLE_BUTTON_SELECTOR);
      return btn && btn instanceof HTMLButtonElement ? btn : null;
    };
    const isTempChatEnabled = () => {
      const btn = getTempChatToggleButton();
      if (btn) {
        const label = (btn.getAttribute("aria-label") || "").toLowerCase();
        if (label.includes("turn off") || label.includes("disable")) return true;
        if (label.includes("turn on") || label.includes("enable")) return false;
      }
      const cb = getTempChatCheckbox();
      if (cb) return Boolean(cb.checked);
      const labelEl = document.querySelector(TEMP_CHAT_LABEL_SELECTOR);
      if (labelEl) return true;
      return null;
    };
    const getTempChatClickTarget = () => {
      var _a, _b, _c;
      const checkbox = getTempChatCheckbox();
      if (!checkbox) return null;
      return (_c = (_b = (_a = checkbox.closest("label")) != null ? _a : checkbox.closest(TEMP_CHAT_LABEL_SELECTOR)) != null ? _b : checkbox.closest("button")) != null ? _c : checkbox;
    };
    const ensureTempChatOn = () => {
      const enabled = isTempChatEnabled();
      if (enabled === true) return;
      const btn = getTempChatToggleButton();
      if (btn && !btn.disabled) {
        ctx.helpers.humanClick(btn, "tempchat-enable");
        ctx.logger.debug("TEMPCHAT", "forced on (button)");
        return;
      }
      const checkbox = getTempChatCheckbox();
      if (!checkbox || checkbox.disabled || checkbox.checked) return;
      const target = getTempChatClickTarget();
      if (!target) return;
      ctx.helpers.humanClick(target, "tempchat-enable");
      ctx.logger.debug("TEMPCHAT", "forced on");
    };
    const ensureTempChatOff = () => {
      const enabled = isTempChatEnabled();
      if (enabled === false) return;
      const btn = getTempChatToggleButton();
      if (btn && !btn.disabled) {
        ctx.helpers.humanClick(btn, "tempchat-disable");
        ctx.logger.debug("TEMPCHAT", "forced off (button)");
        return;
      }
      const checkbox = getTempChatCheckbox();
      if (!checkbox || checkbox.disabled || !checkbox.checked) return;
      const target = getTempChatClickTarget();
      if (!target) return;
      ctx.helpers.humanClick(target, "tempchat-disable");
      ctx.logger.debug("TEMPCHAT", "forced off");
    };
    const applyAutoTempChatState = () => {
      if (ctx.settings.autoTempChat) {
        ensureTempChatOn();
      } else {
        ensureTempChatOff();
      }
    };
    const handleNavigationChange = () => {
      const current = location.pathname + location.search;
      if (current === state.lastPath) return;
      state.lastPath = current;
      applyAutoTempChatState();
    };
    const scheduleFallbackNavigationCheck = () => {
      if (state.fallbackTimeoutId !== null) {
        window.clearTimeout(state.fallbackTimeoutId);
      }
      state.fallbackTimeoutId = window.setTimeout(() => {
        if (Date.now() - state.lastNavigationEventAt < NAVIGATION_FALLBACK_DELAY_MS) return;
        if (state.fallbackIntervalId !== null) return;
        state.fallbackIntervalId = window.setInterval(() => {
          handleNavigationChange();
        }, NAVIGATION_FALLBACK_INTERVAL_MS);
      }, NAVIGATION_FALLBACK_DELAY_MS);
    };
    const handleNavigationEvent = () => {
      state.lastNavigationEventAt = Date.now();
      if (state.fallbackIntervalId !== null) {
        window.clearInterval(state.fallbackIntervalId);
        state.fallbackIntervalId = null;
      }
      scheduleFallbackNavigationCheck();
      handleNavigationChange();
    };
    const patchHistory = () => {
      if (state.historyPatched) return;
      state.historyPatched = true;
      state.originalPushState = history.pushState.bind(history);
      state.originalReplaceState = history.replaceState.bind(history);
      history.pushState = (...args) => {
        var _a;
        const result = (_a = state.originalPushState) == null ? void 0 : _a.call(state, ...args);
        window.dispatchEvent(new CustomEvent(NAVIGATION_EVENT_NAME));
        return result;
      };
      history.replaceState = (...args) => {
        var _a;
        const result = (_a = state.originalReplaceState) == null ? void 0 : _a.call(state, ...args);
        window.dispatchEvent(new CustomEvent(NAVIGATION_EVENT_NAME));
        return result;
      };
    };
    const startAutoTempChat = () => {
      if (state.started) return;
      state.started = true;
      state.lastPath = location.pathname + location.search;
      let applyScheduled = false;
      const scheduleApply = () => {
        if (applyScheduled) return;
        applyScheduled = true;
        window.setTimeout(() => {
          applyScheduled = false;
          if (!state.started) return;
          applyAutoTempChatState();
        }, 200);
      };
      patchHistory();
      window.addEventListener("popstate", handleNavigationEvent);
      window.addEventListener(NAVIGATION_EVENT_NAME, handleNavigationEvent);
      state.observer = new MutationObserver(() => scheduleApply());
      state.observer.observe(document.documentElement, { childList: true, subtree: true });
      scheduleFallbackNavigationCheck();
      applyAutoTempChatState();
    };
    const stopAutoTempChat = () => {
      if (!state.started) return;
      state.started = false;
      window.removeEventListener("popstate", handleNavigationEvent);
      window.removeEventListener(NAVIGATION_EVENT_NAME, handleNavigationEvent);
      if (state.historyPatched) {
        if (state.originalPushState) {
          history.pushState = state.originalPushState;
        }
        if (state.originalReplaceState) {
          history.replaceState = state.originalReplaceState;
        }
        state.historyPatched = false;
      }
      if (state.observer) {
        state.observer.disconnect();
        state.observer = null;
      }
      if (state.fallbackIntervalId !== null) {
        window.clearInterval(state.fallbackIntervalId);
        state.fallbackIntervalId = null;
      }
      if (state.fallbackTimeoutId !== null) {
        window.clearTimeout(state.fallbackTimeoutId);
        state.fallbackTimeoutId = null;
      }
    };
    const ensureStarted = () => {
      if (state.domReady) {
        startAutoTempChat();
        applyAutoTempChatState();
        return;
      }
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          state.domReady = true;
          startAutoTempChat();
          applyAutoTempChatState();
        },
        { once: true }
      );
    };
    ensureStarted();
    applyAutoTempChatState();
    return {
      name: "autoTempChat",
      dispose: () => {
        stopAutoTempChat();
      },
      onSettingsChange: (next, prev) => {
        if (!prev.autoTempChat && next.autoTempChat) {
          ensureStarted();
        }
        if (prev.autoTempChat !== next.autoTempChat) {
          applyAutoTempChatState();
        }
      },
      getStatus: () => ({
        active: ctx.settings.autoTempChat,
        details: ctx.settings.autoTempChat ? "enabled" : "disabled"
      })
    };
  }

  // src/features/autoExpandChats.ts
  var AUTO_EXPAND_START_TIMEOUT_MS = 3500;
  var AUTO_EXPAND_NAV_TIMEOUT_MS = 1500;
  function initAutoExpandChatsFeature(ctx) {
    const qs = (sel, root = document) => root.querySelector(sel);
    const state = {
      started: false,
      runId: 0
    };
    const waitForSpaReady = async () => {
      const ok1 = await ctx.helpers.waitPresent(
        '[data-testid="blocking-initial-modals-done"]',
        document,
        12e3
      );
      if (!ok1) return false;
      const ok2 = await ctx.helpers.waitPresent(
        '#history, #stage-slideover-sidebar, nav[aria-label="Chat history"]',
        document,
        12e3
      );
      return Boolean(ok2);
    };
    const autoExpandDispatchClick = (el) => {
      const seq = ["pointerdown", "mousedown", "mouseup", "click"];
      for (const t of seq) {
        el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
      }
    };
    const autoExpandReset = () => {
      state.started = false;
      state.runId += 1;
    };
    const autoExpandSidebarEl = () => {
      const sb = qs("#stage-slideover-sidebar");
      if (sb) return sb;
      const history2 = document.getElementById("history");
      const nav = history2 == null ? void 0 : history2.closest("nav");
      if (nav) return nav;
      const anyNav = qs("nav");
      return anyNav;
    };
    const autoExpandSidebarIsOpen = () => {
      const sb = autoExpandSidebarEl();
      if (!sb) return false;
      if (!isElementVisible(sb)) return false;
      return sb.getBoundingClientRect().width >= 120;
    };
    const autoExpandOpenSidebarButton = () => qs(
      '#stage-sidebar-tiny-bar button[aria-label="Open sidebar"][aria-controls="stage-slideover-sidebar"]'
    ) || qs(
      'button[aria-label="Open sidebar"][aria-controls="stage-slideover-sidebar"]'
    );
    const autoExpandEnsureSidebarOpen = () => {
      if (autoExpandSidebarIsOpen()) return false;
      const btn = autoExpandOpenSidebarButton();
      if (!btn || !isElementVisible(btn)) return false;
      autoExpandDispatchClick(btn);
      return true;
    };
    const autoExpandChatHistoryNav = () => {
      const sb = autoExpandSidebarEl();
      if (!sb) return null;
      const oldNav = sb.querySelector('nav[aria-label="Chat history"]');
      if (oldNav) return oldNav;
      const history2 = sb.querySelector("#history");
      if (history2) return sb;
      return sb;
    };
    const autoExpandFindYourChatsSection = (nav) => {
      if (!nav) return null;
      const sections = Array.from(nav.querySelectorAll("div.group\\/sidebar-expando-section"));
      for (const sec of sections) {
        const t = norm(sec.textContent);
        if (t.includes("your chats") || t.includes("your charts") || t.includes("\u0447\u0430\u0442\u044B") || t.includes("\u0438\u0441\u0442\u043E\u0440\u0438\u044F")) {
          return sec;
        }
      }
      if (sections.length >= 4) return sections[3];
      return null;
    };
    const autoExpandSectionCollapsed = (sec) => {
      const btn = sec.querySelector("button[aria-expanded]");
      const expanded = btn == null ? void 0 : btn.getAttribute("aria-expanded");
      if (expanded === "false") return true;
      if (expanded === "true") return false;
      const cls = String(sec.className || "");
      if (cls.includes("sidebar-collapsed-section-margin-bottom")) return true;
      if (cls.includes("sidebar-expanded-section-margin-bottom")) return false;
      if (cls.includes("--sidebar-collapsed-section-margin-bottom")) return true;
      if (cls.includes("--sidebar-expanded-section-margin-bottom")) return false;
      return false;
    };
    const autoExpandExpandYourChats = () => {
      if (!autoExpandSidebarIsOpen()) return false;
      const nav = autoExpandChatHistoryNav();
      if (!nav || !isElementVisible(nav)) return false;
      const sec = autoExpandFindYourChatsSection(nav);
      if (!sec) return false;
      if (!autoExpandSectionCollapsed(sec)) return false;
      const btn = sec.querySelector("button[aria-expanded]") || sec.querySelector("button.text-token-text-tertiary.flex.w-full") || sec.querySelector("button") || sec.querySelector('[role="button"]');
      if (!btn || !isElementVisible(btn)) return false;
      autoExpandDispatchClick(btn);
      return true;
    };
    const autoExpandWaitForSidebar = async () => {
      const sidebarSelector = "#history, #stage-slideover-sidebar";
      const openButtonSelector = '#stage-sidebar-tiny-bar button[aria-label="Open sidebar"][aria-controls="stage-slideover-sidebar"], button[aria-label="Open sidebar"][aria-controls="stage-slideover-sidebar"]';
      const selector = `${sidebarSelector}, ${openButtonSelector}`;
      return ctx.helpers.waitPresent(selector, document, AUTO_EXPAND_START_TIMEOUT_MS);
    };
    const autoExpandRunOnce = async (runId) => {
      if (!ctx.settings.autoExpandChats) return false;
      const present = await autoExpandWaitForSidebar();
      if (!present || runId !== state.runId || !ctx.settings.autoExpandChats) {
        if (runId === state.runId && ctx.settings.autoExpandChats) {
          ctx.logger.debug("AUTOEXPAND", "sidebar not found on start (timeout)");
        }
        return false;
      }
      if (autoExpandSidebarIsOpen()) {
        const nav2 = await ctx.helpers.waitPresent(
          '#history, nav[aria-label="Chat history"], #stage-slideover-sidebar',
          document,
          AUTO_EXPAND_NAV_TIMEOUT_MS
        );
        if (!nav2 || runId !== state.runId || !ctx.settings.autoExpandChats) {
          if (runId === state.runId && ctx.settings.autoExpandChats) {
            ctx.logger.debug("AUTOEXPAND", "sidebar not found on start (timeout)");
          }
          return false;
        }
        const root2 = autoExpandChatHistoryNav();
        const sec2 = autoExpandFindYourChatsSection(root2);
        if (sec2 && !autoExpandSectionCollapsed(sec2)) {
          ctx.logger.debug("AUTOEXPAND", "already expanded on start");
          return true;
        }
      }
      if (!autoExpandSidebarIsOpen()) {
        autoExpandEnsureSidebarOpen();
      }
      const nav = await ctx.helpers.waitPresent(
        '#history, nav[aria-label="Chat history"], #stage-slideover-sidebar',
        document,
        AUTO_EXPAND_NAV_TIMEOUT_MS
      );
      if (!nav || runId !== state.runId || !ctx.settings.autoExpandChats) {
        if (runId === state.runId && ctx.settings.autoExpandChats) {
          ctx.logger.debug("AUTOEXPAND", "sidebar not found on start (timeout)");
        }
        return false;
      }
      const root = autoExpandChatHistoryNav();
      const sec = autoExpandFindYourChatsSection(root);
      if (sec && !autoExpandSectionCollapsed(sec)) {
        ctx.logger.debug("AUTOEXPAND", "already expanded on start");
        return true;
      }
      if (autoExpandExpandYourChats()) {
        ctx.logger.debug("AUTOEXPAND", "expanded on start");
        return true;
      }
      return false;
    };
    const startAutoExpand = () => {
      if (state.started) return;
      state.started = true;
      const currentRun = state.runId;
      void (async () => {
        if (!ctx.settings.autoExpandChats) return;
        if (currentRun !== state.runId) return;
        const spaReady = await waitForSpaReady();
        if (!spaReady) {
          if (currentRun === state.runId && ctx.settings.autoExpandChats) {
            ctx.logger.debug("AUTOEXPAND", "spa not ready (timeout), skip");
          }
          return;
        }
        if (currentRun !== state.runId || !ctx.settings.autoExpandChats) return;
        const done = await autoExpandRunOnce(currentRun);
        if (!done) {
          ctx.logger.debug("AUTOEXPAND", "runOnce returned false");
        }
      })();
    };
    const ensureStarted = () => {
      if (!ctx.settings.autoExpandChats) return;
      startAutoExpand();
    };
    ensureStarted();
    return {
      name: "autoExpandChats",
      dispose: () => {
        state.runId += 1;
      },
      onSettingsChange: (next, prev) => {
        if (!prev.autoExpandChats && next.autoExpandChats) {
          autoExpandReset();
          ensureStarted();
        }
        if (prev.autoExpandChats && !next.autoExpandChats) {
          state.runId += 1;
        }
      },
      getStatus: () => ({ active: ctx.settings.autoExpandChats })
    };
  }

  // src/application/wideChat.ts
  var WIDE_CHAT_FULL_WIDTH_PCT = 0.95;
  var buildWideChatStyleText = ({
    basePx,
    wideChatWidth,
    windowWidth
  }) => {
    if (wideChatWidth <= 0) return null;
    if (!Number.isFinite(basePx) || !Number.isFinite(windowWidth)) return null;
    const fullPx = Math.round(windowWidth * WIDE_CHAT_FULL_WIDTH_PCT);
    const sideMarginPx = Math.max(0, Math.round((windowWidth - fullPx) / 2));
    const targetPx = Math.round(basePx + wideChatWidth / 100 * (fullPx - basePx));
    const maxAllowedPx = Math.max(320, fullPx);
    return `
    :root{
      --wide-chat-target-max-width: ${targetPx}px;
      --wide-chat-side-margin: ${sideMarginPx}px;
      --wide-chat-max-allowed: ${maxAllowedPx}px;
    }

    [class*="px-(--thread-content-margin)"]{
      --thread-content-margin: var(--wide-chat-side-margin) !important;
    }

    [class*="max-w-(--thread-content-max-width)"]{
      --thread-content-max-width: var(--wide-chat-target-max-width) !important;
      max-width: min(var(--wide-chat-target-max-width), var(--wide-chat-max-allowed)) !important;
    }
  `.trim();
  };
  var updateWideChatStyle = (style, inputs) => {
    const cssText = buildWideChatStyleText(inputs);
    if (!cssText) return false;
    if (style.textContent === cssText) return false;
    style.textContent = cssText;
    return true;
  };

  // src/features/wideChat.ts
  var WIDE_CHAT_STYLE_ID = "qqrm-wide-chat-style";
  function initWideChatFeature(ctx) {
    const state = {
      started: false,
      observer: null,
      resizeHandler: null,
      baseWidthPx: null,
      scheduled: false
    };
    const findWideChatContentEl = () => {
      const selectors = [
        'main [class*="max-w-(--thread-content-max-width)"]',
        '[class*="max-w-(--thread-content-max-width)"]',
        'main [data-testid*="conversation" i]',
        'main [data-testid*="thread" i]',
        "main article",
        "main section"
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      const main = document.querySelector("main");
      if (!main) return null;
      const candidates = Array.from(main.querySelectorAll("div, section, article"));
      let best = null;
      let bestScore = -Infinity;
      for (const el of candidates) {
        const style = window.getComputedStyle(el);
        const maxW = style.maxWidth;
        if (!maxW || maxW === "none") continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 400 || rect.width > window.innerWidth) continue;
        const score = rect.width;
        if (score > bestScore) {
          bestScore = score;
          best = el;
        }
      }
      return best;
    };
    const ensureWideChatBaseWidth = () => {
      if (state.baseWidthPx !== null) return state.baseWidthPx;
      const contentEl = findWideChatContentEl();
      if (!contentEl) return null;
      const rect = contentEl.getBoundingClientRect();
      if (rect.width <= 1) return null;
      state.baseWidthPx = Math.round(rect.width);
      return state.baseWidthPx;
    };
    const ensureWideChatStyle = () => {
      let style = document.getElementById(WIDE_CHAT_STYLE_ID);
      if (!style) {
        style = document.createElement("style");
        style.id = WIDE_CHAT_STYLE_ID;
        document.documentElement.appendChild(style);
      }
      return style;
    };
    const removeWideChatStyle = () => {
      const style = document.getElementById(WIDE_CHAT_STYLE_ID);
      if (style) style.remove();
    };
    const applyWideChatWidth = () => {
      if (ctx.settings.wideChatWidth <= 0) return;
      const basePx = ensureWideChatBaseWidth();
      if (!basePx) return;
      const style = ensureWideChatStyle();
      updateWideChatStyle(style, {
        basePx,
        wideChatWidth: ctx.settings.wideChatWidth,
        windowWidth: window.innerWidth
      });
    };
    const scheduleWideChatUpdate = () => {
      if (state.scheduled) return;
      state.scheduled = true;
      requestAnimationFrame(() => {
        state.scheduled = false;
        applyWideChatWidth();
      });
    };
    const startWideChat = () => {
      if (state.started) return;
      state.started = true;
      state.baseWidthPx = null;
      state.resizeHandler = () => scheduleWideChatUpdate();
      window.addEventListener("resize", state.resizeHandler, { passive: true });
      state.observer = new MutationObserver((mutations) => {
        const style = document.getElementById(WIDE_CHAT_STYLE_ID);
        if (style && mutations.length > 0 && mutations.every((mutation) => style.contains(mutation.target))) {
          return;
        }
        scheduleWideChatUpdate();
      });
      state.observer.observe(document.documentElement, { childList: true, subtree: true });
      scheduleWideChatUpdate();
    };
    const stopWideChat = () => {
      if (!state.started) return;
      state.started = false;
      if (state.resizeHandler) {
        window.removeEventListener("resize", state.resizeHandler);
        state.resizeHandler = null;
      }
      if (state.observer) {
        state.observer.disconnect();
        state.observer = null;
      }
      state.baseWidthPx = null;
      removeWideChatStyle();
    };
    const updateWideChatState = () => {
      if (ctx.settings.wideChatWidth > 0) {
        if (!state.started) startWideChat();
        else scheduleWideChatUpdate();
        return;
      }
      stopWideChat();
    };
    updateWideChatState();
    return {
      name: "wideChat",
      dispose: () => {
        stopWideChat();
      },
      onSettingsChange: (next, prev) => {
        if (next.wideChatWidth !== prev.wideChatWidth) {
          updateWideChatState();
        }
      },
      getStatus: () => ({
        active: ctx.settings.wideChatWidth > 0,
        details: ctx.settings.wideChatWidth > 0 ? String(ctx.settings.wideChatWidth) : void 0
      })
    };
  }

  // src/features/chatgptEditor.ts
  var norm2 = (value) => (value || "").trim().toLowerCase();
  var isMainComposer = (composer) => {
    if (composer instanceof HTMLElement) {
      if (composer.id === "prompt-textarea") return true;
      if (composer.getAttribute("data-testid") === "prompt-textarea") return true;
    }
    return false;
  };
  var findEditSubmitButton = (composer) => {
    var _a;
    if (isMainComposer(composer)) return null;
    const closestForm = composer.closest("form");
    if (closestForm) {
      const submitBtn = closestForm.querySelector(
        'button[type="submit"], [role="button"][type="submit"]'
      );
      if (submitBtn instanceof HTMLElement && !isDisabled(submitBtn) && submitBtn.offsetParent !== null) {
        return submitBtn;
      }
    }
    const searchRoots = [
      composer.closest('[role="dialog"], [role="alertdialog"]'),
      composer.closest("article"),
      composer.closest("[data-message-author-role]"),
      composer.closest('[data-testid*="message" i]'),
      composer.closest("div")
    ];
    const root = (_a = searchRoots.find((x) => !!x)) != null ? _a : null;
    if (!root) return null;
    const buttons = Array.from(root.querySelectorAll("button, [role='button']")).filter(
      (btn) => btn instanceof HTMLElement
    );
    const positive = [
      "save",
      "save and submit",
      "submit",
      "apply",
      "update",
      "done",
      "ok",
      "\u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C",
      "\u0441\u043E\u0445\u0440\u0430\u043D",
      "\u043F\u0440\u0438\u043C\u0435\u043D\u0438\u0442\u044C",
      "\u0433\u043E\u0442\u043E\u0432\u043E"
    ];
    const negative = ["cancel", "close", "dismiss", "\u043E\u0442\u043C\u0435\u043D\u0430", "\u043E\u0442\u043C\u0435\u043D\u0438\u0442\u044C"];
    const candidates = buttons.filter((btn) => {
      if (isDisabled(btn)) return false;
      const aria = norm2(btn.getAttribute("aria-label"));
      const title = norm2(btn.getAttribute("title"));
      const dt = norm2(btn.getAttribute("data-testid"));
      const txt = norm2(btn.textContent);
      const hay = `${aria} ${title} ${dt} ${txt}`;
      if (negative.some((x) => hay.includes(x))) return false;
      return positive.some((x) => hay.includes(x));
    }).filter((btn) => btn.offsetParent !== null);
    if (candidates.length > 0) return candidates[0];
    const byTestId = buttons.find((btn) => {
      if (isDisabled(btn)) return false;
      const dt = norm2(btn.getAttribute("data-testid"));
      if (!dt) return false;
      if (dt.includes("save")) return true;
      if (dt.includes("submit")) return true;
      if (dt.includes("apply")) return true;
      if (dt.includes("update")) return true;
      return false;
    });
    return byTestId != null ? byTestId : null;
  };

  // src/features/keyCombos.ts
  var normalizeKey = (value) => value.trim().toLowerCase();
  var matchesKeyCombo = (event, combo) => {
    if (normalizeKey(event.key) !== normalizeKey(combo.key)) return false;
    if (combo.ctrl !== void 0 && event.ctrlKey !== combo.ctrl) return false;
    if (combo.meta !== void 0 && event.metaKey !== combo.meta) return false;
    if (combo.shift !== void 0 && event.shiftKey !== combo.shift) return false;
    if (combo.alt !== void 0 && event.altKey !== combo.alt) return false;
    if (combo.when && !combo.when(event)) return false;
    return true;
  };
  var routeKeyCombos = (event, combos) => {
    const ranked = combos.map((combo, index) => ({ combo, index })).sort((a, b) => {
      var _a, _b;
      const ap = (_a = a.combo.priority) != null ? _a : 0;
      const bp = (_b = b.combo.priority) != null ? _b : 0;
      if (bp !== ap) return bp - ap;
      return a.index - b.index;
    });
    for (const { combo } of ranked) {
      if (!matchesKeyCombo(event, combo)) continue;
      combo.handler(event);
      return combo;
    }
    return null;
  };

  // src/features/ctrlEnterSend.ts
  function initCtrlEnterSendFeature(ctx) {
    const norm3 = (value) => (value || "").trim().toLowerCase();
    const findComposerInput2 = () => {
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
    const findActiveEditableTarget = () => {
      const active = document.activeElement;
      if (active instanceof HTMLTextAreaElement) return active;
      if (active instanceof HTMLElement && active.isContentEditable) return active;
      return findComposerInput2();
    };
    const isComposerEventTarget = (e) => {
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
    const insertNewlineAtCaret = (input) => {
      var _a, _b;
      if (input instanceof HTMLTextAreaElement) {
        const start = (_a = input.selectionStart) != null ? _a : input.value.length;
        const end = (_b = input.selectionEnd) != null ? _b : input.value.length;
        input.value = `${input.value.slice(0, start)}
${input.value.slice(end)}`;
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
    const findSendButton2 = (composer) => {
      const selectors = [
        '[data-testid="send-button"]',
        'button[aria-label*="Send" i]',
        '[role="button"][aria-label*="Send" i]',
        'button[aria-label="Submit"]',
        '[role="button"][aria-label="Submit"]',
        'button[aria-label*="\u041E\u0442\u043F\u0440\u0430\u0432" i]'
      ];
      for (const selector of selectors) {
        const btn = document.querySelector(selector);
        if (btn instanceof HTMLElement && isVisible2(btn)) return btn;
      }
      const form = composer == null ? void 0 : composer.closest("form");
      if (!form) return null;
      const submitBtn = form.querySelector('button[type="submit"], [role="button"][type="submit"]');
      if (submitBtn instanceof HTMLElement && isVisible2(submitBtn)) return submitBtn;
      return null;
    };
    const isVisible2 = (btn) => btn.offsetParent !== null;
    const isDictationStopButton = (btn) => {
      const aria = norm3(btn.getAttribute("aria-label"));
      const title = norm3(btn.getAttribute("title"));
      const dt = norm3(btn.getAttribute("data-testid"));
      const txt = norm3(btn.textContent);
      const hay = `${aria} ${title} ${dt} ${txt}`;
      if (hay.includes("stop generating")) return false;
      if (dt.includes("stop-generating")) return false;
      if (hay.includes("stop dictation") || hay.includes("stop recording") || hay.includes("stop voice") || hay.includes("stop microphone"))
        return true;
      if (hay.includes("stop") && (hay.includes("dictat") || hay.includes("record") || hay.includes("microphone") || hay.includes("voice") || hay.includes("\u0434\u0438\u043A\u0442\u043E\u0432") || hay.includes("\u0437\u0430\u043F\u0438\u0441") || hay.includes("\u0433\u043E\u043B\u043E\u0441") || hay.includes("\u043C\u0438\u043A\u0440\u043E\u0444")))
        return true;
      return false;
    };
    const isSubmitDictationButton = (btn) => {
      const aria = norm3(btn.getAttribute("aria-label"));
      const title = norm3(btn.getAttribute("title"));
      const dt = norm3(btn.getAttribute("data-testid"));
      const txt = norm3(btn.textContent);
      if (aria === "submit") {
        if (btn.classList.contains("composer-submit-btn")) return false;
        let p = btn.parentElement;
        for (let i = 0; i < 8 && p; i += 1) {
          const hasDictateButton = !!p.querySelector(
            'button[aria-label="Dictate button"], [role="button"][aria-label="Dictate button"]'
          );
          if (hasDictateButton) return true;
          p = p.parentElement;
        }
      }
      if (aria.includes("submit dictation")) return true;
      if (aria.includes("dictation") && (aria.includes("submit") || aria.includes("accept") || aria.includes("confirm")))
        return true;
      if (aria.includes("\u0433\u043E\u0442\u043E\u0432\u043E")) return true;
      if (aria.includes("\u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0434")) return true;
      if (aria.includes("\u043F\u0440\u0438\u043D\u044F\u0442\u044C")) return true;
      if (dt.includes("dictation") && (dt.includes("submit") || dt.includes("done") || dt.includes("finish")))
        return true;
      if (title.includes("submit dictation")) return true;
      if (txt.includes("submit dictation")) return true;
      return false;
    };
    const findDictationStopButton = () => {
      const buttons = Array.from(document.querySelectorAll("button, [role='button']")).filter(
        (btn) => btn instanceof HTMLElement
      );
      for (const btn of buttons) {
        if (!isVisible2(btn)) continue;
        if (isDisabled(btn)) continue;
        if (isDictationStopButton(btn)) return btn;
      }
      return null;
    };
    const findSubmitDictationButton = () => {
      const buttons = Array.from(document.querySelectorAll("button, [role='button']")).filter(
        (btn) => btn instanceof HTMLElement
      );
      for (const btn of buttons) {
        if (!isVisible2(btn)) continue;
        if (isDisabled(btn)) continue;
        if (isSubmitDictationButton(btn)) return btn;
      }
      return null;
    };
    const waitForInputToStabilize = (input, timeoutMs, quietMs) => new Promise((resolve) => {
      const t0 = performance.now();
      const readInputValue = () => input instanceof HTMLTextAreaElement ? input.value : input.innerText || "";
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
    const waitForSendButtonReady = (composer, timeoutMs, pollMs) => new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        const btn = findSendButton2(composer);
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
    const stopEvent = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") {
        e.stopImmediatePropagation();
      }
    };
    let lastEnterShouldSendAt = 0;
    let lastEnterShouldSend = false;
    let lastEnterShiftAt = 0;
    const handlePlainEnter = (e, target) => {
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
    const handleCtrlEnter = (e, target) => {
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
          await waitForInputToStabilize(target, 2500, 250);
          const sendBtn2 = await waitForSendButtonReady(target, 4e3, 60);
          if (sendBtn2) {
            ctx.logger.debug("KEY", "CTRL+ENTER send");
            sendBtn2.click();
          } else {
            ctx.logger.debug("KEY", "send button not ready");
          }
          return;
        }
        const stopBtn = findDictationStopButton();
        if (stopBtn) {
          ctx.logger.debug("KEY", "CTRL+ENTER stop dictation");
          stopBtn.click();
          await waitForInputToStabilize(target, 2500, 250);
          const submitBtnAfter = findSubmitDictationButton();
          if (submitBtnAfter) {
            ctx.logger.debug("KEY", "CTRL+ENTER submit dictation after stop");
            submitBtnAfter.click();
            await waitForInputToStabilize(target, 2500, 250);
          }
          const sendBtn2 = await waitForSendButtonReady(target, 4e3, 60);
          if (sendBtn2) {
            ctx.logger.debug("KEY", "CTRL+ENTER send");
            sendBtn2.click();
          } else {
            ctx.logger.debug("KEY", "send button not ready");
          }
          return;
        }
        const sendBtn = findSendButton2(target);
        if (sendBtn && !isDisabled(sendBtn)) {
          ctx.logger.debug("KEY", "CTRL+ENTER send");
          sendBtn.click();
        } else {
          ctx.logger.debug("KEY", "send button not found");
        }
      })();
    };
    const handleKeyDown = (e) => {
      if (!ctx.settings.ctrlEnterSends) return;
      if (e.defaultPrevented) return;
      if (e.isComposing && !(e.ctrlKey || e.metaKey)) return;
      if (e.key !== "Enter") return;
      const shouldSend = e.ctrlKey || e.metaKey;
      let target = findActiveEditableTarget();
      const outsideComposerOk = shouldHandleCtrlEnterOutsideComposer();
      if (!target && outsideComposerOk) {
        target = findComposerInput2();
      }
      const composerOk = !!target && (isComposerEventTarget(e) || outsideComposerOk);
      if (!composerOk) return;
      if (!shouldSend && e.shiftKey) {
        lastEnterShiftAt = performance.now();
        return;
      }
      if (shouldSend && target) {
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
    const handleBeforeInput = (e) => {
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

  // src/features/compatibilityMonitor.ts
  var TOAST_ROOT_ID = "qqrm-compat-toast-root";
  var TOAST_ID = "qqrm-compat-toast";
  function isChatUiLike() {
    if (document.getElementById("prompt-textarea")) return true;
    if (document.querySelector("form.group\\/composer")) return true;
    if (document.querySelector('[data-testid="composer-footer-actions"]')) return true;
    if (document.querySelector('nav[aria-label="Chat history"]')) return true;
    if (document.getElementById("history")) return true;
    return false;
  }
  function findComposerRoot() {
    const byClass = document.querySelector("form.group\\/composer");
    if (byClass) return byClass;
    const byFooter = document.querySelector('[data-testid="composer-footer-actions"]');
    if (byFooter) return byFooter.closest("form");
    const prompt = document.getElementById("prompt-textarea");
    if (prompt) return prompt.closest("form, footer");
    return null;
  }
  function findComposerInput(root) {
    const scope = root != null ? root : document;
    const textarea = scope.querySelector("textarea");
    if (textarea) return textarea;
    const ce = scope.querySelector('[contenteditable="true"]');
    if (ce) return ce;
    const byId = document.getElementById("prompt-textarea");
    if (byId) return byId;
    return null;
  }
  function findSendButton(root) {
    const scope = root != null ? root : document;
    const byTestId = scope.querySelector('[data-testid="send-button"]');
    if (byTestId) return byTestId;
    const submit = scope.querySelector('button[type="submit"]');
    if (submit) return submit;
    const any = scope.querySelector('button[aria-label*="send" i]');
    return any;
  }
  function hasDictationToggle() {
    var _a, _b;
    return Boolean(
      (_b = (_a = document.querySelector('button[data-testid="composer-speech-button"]')) != null ? _a : document.querySelector('button[aria-label="Dictate button"]')) != null ? _b : document.querySelector('button[aria-label*="dictate" i]')
    );
  }
  function hasTemporaryChatToggle() {
    var _a;
    return Boolean(
      (_a = document.querySelector('button[aria-label*="temporary chat" i]')) != null ? _a : document.querySelector('[data-testid*="temporary" i]')
    );
  }
  function hasHistoryOptionsButtons() {
    var _a, _b;
    return Boolean(
      (_b = (_a = document.querySelector('button[data-testid^="history-item-"][data-testid$="-options"]')) != null ? _a : document.querySelector('button[aria-label*="conversation options" i]')) != null ? _b : document.querySelector('button[aria-label*="open conversation options" i]')
    );
  }
  function hasHistoryRoot() {
    return Boolean(document.getElementById("history"));
  }
  function hasYourChatsExpandoToggle() {
    var _a;
    return Boolean(
      (_a = document.querySelector("div.group\\/sidebar-expando-section button[aria-expanded]")) != null ? _a : document.querySelector('button[aria-expanded][aria-controls*="history" i]')
    );
  }
  function hasOpenSidebarButton() {
    var _a;
    return Boolean(
      (_a = document.querySelector(
        'button[aria-label="Open sidebar"][aria-controls="stage-slideover-sidebar"]'
      )) != null ? _a : document.querySelector('button[aria-label="Open sidebar"]')
    );
  }
  function hasUserMessages() {
    return Boolean(document.querySelector('[data-message-author-role="user"]'));
  }
  function hasEditButtons() {
    const btns = Array.from(document.querySelectorAll("button"));
    for (const b of btns) {
      const dt = norm(b.getAttribute("data-testid"));
      const a = norm(b.getAttribute("aria-label"));
      const t = norm(b.getAttribute("title"));
      const txt = norm(b.textContent);
      if (dt.includes("edit")) return true;
      if (a.includes("edit") || a.includes("\u0440\u0435\u0434\u0430\u043A\u0442") || a.includes("\u0438\u0437\u043C\u0435\u043D")) return true;
      if (t.includes("edit") || t.includes("\u0440\u0435\u0434\u0430\u043A\u0442") || t.includes("\u0438\u0437\u043C\u0435\u043D")) return true;
      if (txt.includes("edit") || txt.includes("\u0440\u0435\u0434\u0430\u043A\u0442") || txt.includes("\u0438\u0437\u043C\u0435\u043D")) return true;
    }
    return false;
  }
  function runCompatibilityChecks(ctx) {
    if (!ctx.settings.showCompatibilityWarnings) return [];
    if (!isChatUiLike()) return [];
    const issues = [];
    const composerRoot = findComposerRoot();
    const composerInput = findComposerInput(composerRoot);
    const sendBtn = findSendButton(composerRoot);
    const needsComposer = ctx.settings.autoSend || ctx.settings.ctrlEnterSends;
    if (needsComposer) {
      if (!composerRoot) {
        issues.push({
          id: "composer.root",
          severity: "error",
          title: "Composer not found",
          details: "The message composer container could not be located."
        });
      } else {
        if (!composerInput) {
          const hasCanvas = Boolean(composerRoot.querySelector("canvas"));
          issues.push({
            id: "composer.input",
            severity: "error",
            title: "Composer input not found",
            details: hasCanvas ? "Only a canvas-based input was detected. The extension expects textarea/contenteditable." : "No textarea/contenteditable input found inside the composer."
          });
        }
        if (!sendBtn) {
          issues.push({
            id: "composer.send",
            severity: "warn",
            title: "Send button not found",
            details: "Auto-send / Ctrl+Enter may fail because the Send button selector did not match."
          });
        }
      }
    }
    if (ctx.settings.startDictation && !hasDictationToggle()) {
      issues.push({
        id: "dictation.toggle",
        severity: "warn",
        title: "Dictation toggle not found",
        details: "Ctrl+Space dictation toggle may be outdated for the current ChatGPT UI."
      });
    }
    if (ctx.settings.autoTempChat && !hasTemporaryChatToggle()) {
      issues.push({
        id: "tempchat.toggle",
        severity: "warn",
        title: "Temporary Chat toggle not found",
        details: "Auto-enable Temporary Chat may no longer match the current ChatGPT UI."
      });
    }
    if (ctx.settings.oneClickDelete && !hasHistoryOptionsButtons()) {
      issues.push({
        id: "history.options",
        severity: "warn",
        title: "Chat history menu buttons not found",
        details: "One-click delete / rename (F2) depend on chat history options buttons."
      });
    }
    if (ctx.settings.autoExpandChats) {
      if (!hasHistoryRoot()) {
        issues.push({
          id: "sidebar.history",
          severity: "warn",
          title: "Sidebar history container not found",
          details: "Auto-expand chats expects a #history container (or equivalent) in the left sidebar."
        });
      }
      if (!hasYourChatsExpandoToggle()) {
        issues.push({
          id: "sidebar.expando",
          severity: "warn",
          title: "Sidebar expando toggle not detected",
          details: 'Auto-expand chats relies on an expando header with aria-expanded (e.g. "Your chats").'
        });
      }
      if (!hasOpenSidebarButton() && !document.querySelector("#stage-slideover-sidebar")) {
        issues.push({
          id: "sidebar.openBtn",
          severity: "warn",
          title: "Open sidebar button not found",
          details: 'If the sidebar is collapsed by default, auto-expand may fail without an "Open sidebar" button.'
        });
      }
    }
    if (ctx.settings.editLastMessageOnArrowUp) {
      if (!hasUserMessages()) {
        issues.push({
          id: "editlast.messages",
          severity: "warn",
          title: "No user messages found",
          details: "ArrowUp edit needs at least one user message in the conversation view."
        });
      } else if (!hasEditButtons()) {
        issues.push({
          id: "editlast.buttons",
          severity: "warn",
          title: "Edit controls not detected",
          details: "The extension could not detect any edit controls for user messages."
        });
      }
    }
    if (ctx.settings.wideChatWidth > 0) {
      const main = document.querySelector("main");
      if (!main) {
        issues.push({
          id: "widechat.main",
          severity: "warn",
          title: "Main container not found",
          details: "Wide Chat could not find <main>, so the width override may not apply."
        });
      }
    }
    return issues;
  }
  function ensureToastRoot() {
    let root = document.getElementById(TOAST_ROOT_ID);
    if (root) return root;
    root = document.createElement("div");
    root.id = TOAST_ROOT_ID;
    root.style.position = "fixed";
    root.style.right = "14px";
    root.style.bottom = "14px";
    root.style.zIndex = "2147483647";
    root.style.pointerEvents = "none";
    document.documentElement.appendChild(root);
    return root;
  }
  function removeToast() {
    const toast = document.getElementById(TOAST_ID);
    toast == null ? void 0 : toast.remove();
  }
  function showToast(issues) {
    removeToast();
    const root = ensureToastRoot();
    const toast = document.createElement("div");
    toast.id = TOAST_ID;
    toast.style.pointerEvents = "auto";
    toast.style.maxWidth = "340px";
    toast.style.borderRadius = "12px";
    toast.style.border = "1px solid rgba(255,255,255,0.14)";
    toast.style.background = "rgba(20, 22, 26, 0.86)";
    toast.style.color = "#fff";
    toast.style.padding = "10px 10px 8px";
    toast.style.font = "12px/16px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    toast.style.boxShadow = "0 10px 30px rgba(0,0,0,0.35)";
    toast.style.backdropFilter = "blur(8px)";
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";
    header.style.gap = "8px";
    const title = document.createElement("div");
    title.textContent = "Compatibility check";
    title.style.fontWeight = "600";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "\xD7";
    close.style.border = "none";
    close.style.background = "transparent";
    close.style.color = "rgba(255,255,255,0.8)";
    close.style.fontSize = "16px";
    close.style.lineHeight = "16px";
    close.style.cursor = "pointer";
    close.addEventListener("click", () => removeToast());
    header.appendChild(title);
    header.appendChild(close);
    toast.appendChild(header);
    const list = document.createElement("ul");
    list.style.margin = "8px 0 0";
    list.style.padding = "0 0 0 18px";
    for (const issue of issues.slice(0, 6)) {
      const item = document.createElement("li");
      item.textContent = issue.title;
      item.style.margin = "2px 0";
      list.appendChild(item);
    }
    toast.appendChild(list);
    if (issues.length > 6) {
      const more = document.createElement("div");
      more.textContent = `\u2026and ${issues.length - 6} more`;
      more.style.marginTop = "4px";
      more.style.color = "rgba(255,255,255,0.7)";
      toast.appendChild(more);
    }
    root.appendChild(toast);
    window.setTimeout(() => {
      if (document.getElementById(TOAST_ID)) removeToast();
    }, 12e3);
  }
  function initCompatibilityMonitorFeature(ctx) {
    let enabled = Boolean(ctx.settings.showCompatibilityWarnings);
    let lastIds = /* @__PURE__ */ new Set();
    let scheduled = false;
    let mo = null;
    const logIssues = (issues) => {
      var _a, _b;
      for (const issue of issues) {
        const prefix = "[cgptbe][compat]";
        const msg = `${prefix} ${issue.title}`;
        if (issue.severity === "error") console.error(msg, (_a = issue.details) != null ? _a : "");
        else console.warn(msg, (_b = issue.details) != null ? _b : "");
      }
    };
    const evaluate = () => {
      if (!enabled) return;
      const issues = runCompatibilityChecks(ctx);
      const currentIds = new Set(issues.map((x) => x.id));
      const hasNew = issues.some((x) => !lastIds.has(x.id));
      lastIds = currentIds;
      if (issues.length === 0) {
        removeToast();
        return;
      }
      if (hasNew) {
        logIssues(issues);
        showToast(issues);
      }
    };
    const schedule = () => {
      if (!enabled) return;
      if (scheduled) return;
      scheduled = true;
      window.setTimeout(() => {
        scheduled = false;
        evaluate();
      }, 800);
    };
    const start = () => {
      if (mo) return;
      schedule();
      mo = new MutationObserver(() => schedule());
      mo.observe(document.documentElement, { childList: true, subtree: true });
      window.setTimeout(() => evaluate(), 2e3);
    };
    const stop = () => {
      mo == null ? void 0 : mo.disconnect();
      mo = null;
      lastIds = /* @__PURE__ */ new Set();
      removeToast();
    };
    if (enabled) start();
    return {
      name: "compatibilityMonitor",
      dispose: () => stop(),
      onSettingsChange: (next) => {
        const nextEnabled = Boolean(next.showCompatibilityWarnings);
        if (nextEnabled === enabled) return;
        enabled = nextEnabled;
        if (enabled) start();
        else stop();
      },
      getStatus: () => ({ active: enabled })
    };
  }

  // src/application/contentScript.ts
  var fallbackStoragePort = {
    get: (defaults) => Promise.resolve({ ...defaults }),
    set: () => Promise.resolve()
  };
  var startContentScript = ({ storagePort } = {}) => {
    if (window.__ChatGPTDictationAutoSendLoaded__) return;
    window.__ChatGPTDictationAutoSendLoaded__ = true;
    const log2 = createTrace("content");
    log2.info("startContentScript", {
      href: location.href,
      readyState: document.readyState
    });
    const resolvedStorage = storagePort != null ? storagePort : fallbackStoragePort;
    const DEBUG = false;
    const loadSettings = async () => {
      const stored = await resolvedStorage.get(SETTINGS_DEFAULTS);
      const normalized = normalizeSettings(stored);
      log2.info("settings loaded", normalized);
      return normalized;
    };
    const init = async () => {
      var _a;
      const settings = await loadSettings();
      const ctx = createFeatureContext({
        settings,
        storagePort: resolvedStorage,
        debugEnabled: DEBUG
      });
      const features = [];
      const safeInit = (name, fn) => {
        try {
          const h = fn();
          features.push(h);
          log2.info(`feature init ok: ${name}`, {
            enabled: Boolean(h)
          });
        } catch (e) {
          log2.error(`feature init failed: ${name}`, {
            error: String(e)
          });
        }
      };
      safeInit("compatibilityMonitor", () => initCompatibilityMonitorFeature(ctx));
      safeInit("dictationAutoSend", () => initDictationAutoSendFeature(ctx));
      safeInit("editLastMessage", () => initEditLastMessageFeature(ctx));
      safeInit("autoExpandChats", () => initAutoExpandChatsFeature(ctx));
      safeInit("autoTempChat", () => initAutoTempChatFeature(ctx));
      safeInit("oneClickDelete", () => initOneClickDeleteFeature(ctx));
      safeInit("wideChat", () => initWideChatFeature(ctx));
      safeInit("ctrlEnterSend", () => initCtrlEnterSendFeature(ctx));
      if (ctx.logger.isEnabled) {
        const summary = features.map((feature) => {
          var _a2;
          const status = (_a2 = feature.getStatus) == null ? void 0 : _a2.call(feature);
          const state = (status == null ? void 0 : status.active) ? "on" : "off";
          const details = (status == null ? void 0 : status.details) ? `:${status.details}` : "";
          return `${feature.name}=${state}${details}`;
        }).join(", ");
        ctx.logger.debug("BOOT", "features initialized", { preview: summary });
      }
      const handleStorageChange = (changes, areaName) => {
        if (areaName !== "sync" && areaName !== "local") return;
        if (!changes || !("autoExpandChats" in changes) && !("autoSend" in changes) && !("allowAutoSendInCodex" in changes) && !("editLastMessageOnArrowUp" in changes) && !("autoTempChat" in changes) && !("oneClickDelete" in changes) && !("startDictation" in changes) && !("ctrlEnterSends" in changes) && !("showCompatibilityWarnings" in changes) && !("wideChatWidth" in changes) && !("tempChatEnabled" in changes)) {
          return;
        }
        void (async () => {
          var _a2;
          const nextSettings = await loadSettings();
          const previousSettings = { ...ctx.settings };
          Object.assign(ctx.settings, nextSettings);
          for (const handle of features) {
            (_a2 = handle.onSettingsChange) == null ? void 0 : _a2.call(handle, ctx.settings, previousSettings);
          }
        })();
      };
      (_a = resolvedStorage.onChanged) == null ? void 0 : _a.call(resolvedStorage, handleStorageChange);
    };
    void init();
  };

  // src/infra/storageAdapter.ts
  function toError(err, fallback) {
    return err instanceof Error ? err : new Error(fallback);
  }
  function getStorageArea(storage, preferSync) {
    if (!storage) return null;
    if (preferSync && storage.sync) return storage.sync;
    if (storage.local) return storage.local;
    return null;
  }
  async function storageGet(defaults, storage, lastError) {
    const areaSync = getStorageArea(storage, true);
    const areaLocal = getStorageArea(storage, false);
    const tryGet = (area) => new Promise((resolve, reject) => {
      try {
        const result = area.get(defaults, (res) => {
          var _a;
          const err = (_a = lastError == null ? void 0 : lastError()) != null ? _a : null;
          if (err) reject(toError(err, "Storage get failed"));
          else resolve(res);
        });
        if (isThenable(result)) result.then(resolve, reject);
      } catch (err) {
        reject(toError(err, "Storage get failed"));
      }
    });
    try {
      if (areaSync) {
        const res = await tryGet(areaSync);
        return { ...defaults, ...res || {} };
      }
    } catch {
    }
    try {
      if (areaLocal) {
        const res = await tryGet(areaLocal);
        return { ...defaults, ...res || {} };
      }
    } catch {
    }
    return { ...defaults };
  }
  async function storageSet(values, storage, lastError) {
    const areaSync = getStorageArea(storage, true);
    const areaLocal = getStorageArea(storage, false);
    const trySet = (area) => new Promise((resolve, reject) => {
      try {
        const result = area.set(values, () => {
          var _a;
          const err = (_a = lastError == null ? void 0 : lastError()) != null ? _a : null;
          if (err) reject(toError(err, "Storage set failed"));
          else resolve();
        });
        if (isThenable(result)) result.then(() => resolve(), reject);
      } catch (err) {
        reject(toError(err, "Storage set failed"));
      }
    });
    let syncOk = false;
    try {
      if (areaSync) {
        await trySet(areaSync);
        syncOk = true;
      }
    } catch {
    }
    if (!syncOk && areaLocal) {
      try {
        await trySet(areaLocal);
      } catch {
      }
    }
  }
  function createStoragePort({ storageApi, lastError }) {
    const onChanged = (storageApi == null ? void 0 : storageApi.onChanged) && typeof storageApi.onChanged.addListener === "function" ? (handler) => {
      var _a;
      return (_a = storageApi.onChanged) == null ? void 0 : _a.addListener(handler);
    } : void 0;
    return {
      get: (defaults) => storageGet(defaults, storageApi, lastError),
      set: (values) => storageSet(values, storageApi, lastError),
      onChanged
    };
  }

  // src/lib/webextPolyfill.ts
  function ensureWebExtPolyfill() {
    const g = globalThis;
    if (typeof g.browser !== "undefined") {
      return;
    }
    if (typeof g.chrome === "undefined") {
      return;
    }
    g.browser = {
      runtime: g.chrome.runtime,
      storage: g.chrome.storage
    };
  }

  // src/entries/content.ts
  var trace2 = createTrace("entry:content");
  (async () => {
    var _a, _b, _c;
    try {
      ensureWebExtPolyfill();
      const g = globalThis;
      const storageApi = (_c = (_a = g.browser) == null ? void 0 : _a.storage) != null ? _c : (_b = g.chrome) == null ? void 0 : _b.storage;
      if (!storageApi) {
        trace2.error("No storage API available (browser.storage / chrome.storage missing)");
        return;
      }
      const lastError = () => {
        var _a2, _b2, _c2, _d, _e, _f;
        return (_f = (_e = (_b2 = (_a2 = g.chrome) == null ? void 0 : _a2.runtime) == null ? void 0 : _b2.lastError) != null ? _e : (_d = (_c2 = g.browser) == null ? void 0 : _c2.runtime) == null ? void 0 : _d.lastError) != null ? _f : null;
      };
      const storagePort = createStoragePort({ storageApi, lastError });
      await Promise.resolve(startContentScript({ storagePort }));
    } catch (e) {
      trace2.error("Content script entry failed", e);
    }
  })();
})();
//# sourceMappingURL=content.js.map
