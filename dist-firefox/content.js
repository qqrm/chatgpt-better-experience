"use strict";
(() => {
  // src/domain/settings.ts
  var SETTINGS_DEFAULTS = {
    autoSend: true,
    allowAutoSendInCodex: true,
    editLastMessageOnArrowUp: true,
    autoExpandChats: true,
    autoTempChat: false,
    tempChatEnabled: false,
    oneClickDelete: false,
    startDictation: false,
    ctrlEnterSends: true,
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
    const legacySkipKey = typeof data.skipKey === "string" ? data.skipKey : null;
    const legacyHoldToSend = typeof data.holdToSend === "boolean" ? data.holdToSend : null;
    void legacyHoldToSend;
    const autoSend = typeof data.autoSend === "boolean" ? data.autoSend : legacySkipKey === "None" ? false : true;
    return {
      autoSend,
      allowAutoSendInCodex: typeof data.allowAutoSendInCodex === "boolean" ? data.allowAutoSendInCodex : base.allowAutoSendInCodex,
      editLastMessageOnArrowUp: typeof data.editLastMessageOnArrowUp === "boolean" ? data.editLastMessageOnArrowUp : base.editLastMessageOnArrowUp,
      autoExpandChats: typeof data.autoExpandChats === "boolean" ? data.autoExpandChats : base.autoExpandChats,
      autoTempChat: typeof data.autoTempChat === "boolean" ? data.autoTempChat : base.autoTempChat,
      tempChatEnabled: typeof data.tempChatEnabled === "boolean" ? data.tempChatEnabled : base.tempChatEnabled,
      oneClickDelete: typeof data.oneClickDelete === "boolean" ? data.oneClickDelete : base.oneClickDelete,
      startDictation: typeof data.startDictation === "boolean" ? data.startDictation : base.startDictation,
      ctrlEnterSends: typeof data.ctrlEnterSends === "boolean" ? data.ctrlEnterSends : base.ctrlEnterSends,
      wideChatWidth: (() => {
        const rawWidth = data.wideChatWidth;
        if (typeof rawWidth !== "number" || !Number.isFinite(rawWidth)) {
          return base.wideChatWidth;
        }
        return Math.min(100, Math.max(0, rawWidth));
      })()
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
        if ("preview" in fields) parts.push(`preview="${short(String(fields.preview ?? ""), 120)}"`);
        if ("snapshot" in fields)
          parts.push(`snapshot="${short(String(fields.snapshot ?? ""), 120)}"`);
        if ("btn" in fields) parts.push(`btn="${short(String(fields.btn ?? ""), 160)}"`);
        if (parts.length) tail = " | " + parts.join(" ");
      }
      console.log(`[TM DictationAutoSend] #${logCount} ${t} ${scope}: ${message}${tail}`);
    };
    return { isEnabled: debugEnabled, debug };
  }
  function createFeatureContext({
    settings,
    storagePort: storagePort2,
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
      } catch (_) {
      }
      try {
        el.scrollIntoView({ block: "center", inline: "center" });
      } catch (_) {
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
      } catch (_) {
      }
      try {
        el.dispatchEvent(new MouseEvent("mousedown", common));
      } catch (_) {
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
      } catch (_) {
      }
      try {
        el.dispatchEvent(new MouseEvent("mouseup", common));
      } catch (_) {
      }
      try {
        el.dispatchEvent(new MouseEvent("click", common));
      } catch (_) {
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
      } catch (_) {
        return null;
      }
    };
    return {
      settings,
      storagePort: storagePort2,
      logger,
      keyState: { shift: false, ctrl: false, alt: false },
      helpers: { waitPresent, waitGone, humanClick, debounceScheduler, safeQuery }
    };
  }

  // src/features/dictationAutoSend.ts
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
  function shouldAutoSendFromSubmitClick(e) {
    if (!e?.isTrusted) return false;
    return (e.detail ?? 0) > 0;
  }
  function initDictationAutoSendFeature(ctx) {
    const cfg = { ...DEFAULT_CONFIG };
    let inFlight = false;
    let transcribeHookInstalled = false;
    let lastDictationToggleAt = 0;
    const tmLog = (scope, msg, fields) => {
      ctx.logger.debug(scope, msg, fields);
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
    const findSendButton = () => qs('[data-testid="send-button"]') || qs("#composer-submit-button") || qs("button.composer-submit-btn") || qs("form button[type='submit']") || qs('button[aria-label*="Send"]') || qs('[role="button"][aria-label*="Send"]') || qs('button[aria-label*="\u041E\u0442\u043F\u0440\u0430\u0432"]') || null;
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
      const composerInput = findComposerInput();
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
          if (b === findSendButton()) continue;
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
        tmLog("KEY", "dictation button not found");
        return false;
      }
      tmLog("KEY", "dictation button found");
      btn.click();
      lastDictationToggleAt = performance.now();
      tmLog("KEY", "dictation button clicked");
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
      tmLog("SEND", "stop generating before send", { btn: describeEl2(stopBtn) });
      ctx.helpers.humanClick(stopBtn, "stop generating");
      const ok = await ensureNotGenerating(timeoutMs);
      if (!ok) {
        tmLog("SEND", "stop generating timeout");
      }
      return ok;
    };
    const waitForFinalText = ({ snapshot, timeoutMs, quietMs }) => new Promise((resolve) => {
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
        const stableForMs = performance.now() - lastChangeAt | 0;
        const hasText = v.trim().length > 0;
        if (hasText && stableForMs >= quietMs) {
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
        tmLog("SEND", "send button not found");
        return false;
      }
      if (isDisabled(btn)) {
        tmLog("SEND", "send button disabled", { btn: describeEl2(btn) });
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
          tmLog("SEND", "ack ok", {
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
      tmLog("SEND", "ack timeout", {
        ok: false,
        changed: cur !== before,
        len: cur.length,
        preview: cur
      });
      return false;
    };
    const runFlowAfterSubmitClick = async (submitBtnDesc, snapshotOverride, initialShiftHeld = false) => {
      if (inFlight) {
        tmLog("FLOW", "skip: inFlight already true");
        return;
      }
      inFlight = true;
      let cancelByShift = initialShiftHeld;
      const handleShiftKey = (event) => {
        if (event.key === "Shift") {
          cancelByShift = true;
          tmLog("FLOW", "shift cancel received");
        }
      };
      window.addEventListener("keydown", handleShiftKey, true);
      try {
        if (!cfg.autoSendEnabled) {
          tmLog("FLOW", "auto-send disabled");
          return;
        }
        const snap = readInputText();
        const snapshot = snapshotOverride ?? snap.text;
        tmLog("FLOW", "submit click flow start", {
          btn: submitBtnDesc,
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
          tmLog("FLOW", "no stable final text, abort");
          return;
        }
        if ((finalRes.text || "").trim().length === 0) {
          tmLog("FLOW", "final text empty, abort");
          return;
        }
        if (cancelByShift) {
          tmLog("FLOW", "send skipped by shift");
          return;
        }
        const okGen = await stopGeneratingIfPossible(2e4);
        if (!okGen) {
          tmLog("FLOW", "abort: still generating");
          return;
        }
        if (cancelByShift) {
          tmLog("FLOW", "send skipped by shift");
          return;
        }
        const ok1 = await clickSendWithAck();
        tmLog("FLOW", "send result", { ok: ok1 });
      } catch (e) {
        tmLog("ERR", "flow exception", {
          preview: String(e && e.stack || e.message || e)
        });
      } finally {
        window.removeEventListener("keydown", handleShiftKey, true);
        inFlight = false;
        tmLog("FLOW", "submit click flow end");
      }
    };
    const injectPageTranscribeHook = () => {
      const runtime = globalThis.chrome?.runtime ?? globalThis.browser?.runtime;
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
      if (data.type === "complete") return;
    };
    const handleKeyDown = (e) => {
      if (!cfg.autoSendEnabled && !ctx.settings.startDictation) {
        return;
      }
      const submitDictationVisible = getDictationUiState() === "SUBMIT";
      if (e.code === "Space" && !e.ctrlKey && !e.metaKey && submitDictationVisible) {
        swallowKeyEvent(e);
        return;
      }
      if (submitDictationVisible && (e.ctrlKey || e.metaKey) && e.key === "Enter") {
        swallowKeyEvent(e);
        const submitBtn = findSubmitDictationButton();
        if (submitBtn) {
          tmLog("KEY", "ctrl-enter: submit dictation");
          ctx.helpers.humanClick(submitBtn, "submit-dictation");
        } else {
          tmLog("KEY", "ctrl-enter: submit button not found");
        }
        if (!cfg.autoSendEnabled) {
          tmLog("FLOW", "ctrl-enter: auto-send disabled");
          return;
        }
        void (async () => {
          if (!isCodexPath(location.pathname) || cfg.allowAutoSendInCodex) {
            await runFlowAfterSubmitClick("ctrl-enter dictation submit", void 0, false);
          } else {
            tmLog("FLOW", "ctrl-enter: auto-send skipped on Codex path");
          }
        })();
        return;
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
        const submitBtn = findSubmitDictationButton();
        if (submitBtn) {
          tmLog("KEY", "dictation submit via hotkey", { btn: describeEl2(submitBtn) });
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
      if (cfg.logClicks && isInterestingButton(btn)) {
        const cur = readInputText();
        tmLog("CLICK", "button click", {
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
      const dictationState = getDictationUiState();
      const submitBtn = dictationState === "SUBMIT" ? findSubmitDictationButton() : null;
      const isSubmitClick = dictationState === "SUBMIT" && btn instanceof HTMLElement && (btn === submitBtn || isSubmitDictationButton(btn));
      if (isSubmitClick) {
        if (!shouldAutoSendFromSubmitClick(e) || !cfg.autoSendEnabled) {
          tmLog("FLOW", "submit dictation click ignored: not mouse click", { btn: btnDesc });
          return;
        }
        void (async () => {
          if (!isCodexPath(location.pathname) || cfg.allowAutoSendInCodex) {
            await runFlowAfterSubmitClick(btnDesc, void 0, e.shiftKey);
          } else {
            tmLog("FLOW", "auto-send skipped on Codex path");
          }
        })();
      }
    };
    applySettings();
    window.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("click", handleClick, true);
    installTranscribeHook();
    tmLog("BOOT", "dictation auto-send init", { preview: location.href });
    return {
      name: "dictationAutoSend",
      dispose: () => {
        window.removeEventListener("keydown", handleKeyDown, true);
        document.removeEventListener("click", handleClick, true);
        window.removeEventListener("message", handleTranscribeMessage);
      },
      __test: {
        runAutoSendFlow: (snapshotOverride, initialShiftHeld) => runFlowAfterSubmitClick("test submit dictation", snapshotOverride, !!initialShiftHeld),
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
      const t0 = performance.now();
      while (performance.now() - t0 < timeoutMs) {
        const inChat = findVisibleInput(activeChat);
        if (inChat) return inChat;
        const dialogs = qsa('[role="dialog"]');
        const dialog = dialogs.find((el) => isElementVisible(el)) ?? null;
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
      const optionsSelector = 'button[data-testid^="history-item-"][data-testid$="-options"]';
      return activeChat.querySelector(optionsSelector) ?? activeChat.parentElement?.querySelector(optionsSelector) ?? activeChat.closest("li, div")?.querySelector(optionsSelector) ?? null;
    };
    const triggerRenameActiveChat = async (activeChatOverride) => {
      const activeChat = activeChatOverride ?? findActiveChat();
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
      } catch (_) {
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
      const message = findLastUserMessage();
      if (!message) return false;
      const article = message.closest("article") ?? message.closest("[data-message-author-role]") ?? message.parentElement;
      const searchRoot = article instanceof HTMLElement ? article : message;
      const buttons = qsa("button, [role='button']", searchRoot);
      const editBtn = buttons.find((btn) => {
        const a = norm(btn.getAttribute("aria-label"));
        if (a.includes("edit message")) return true;
        return isEditMessageButton(btn);
      }) ?? null;
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
  var ONE_CLICK_DELETE_BUTTON_SELECTOR = 'button[data-testid^="history-item-"][data-testid$="-options"]';
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
  var extractConversationIdFromRow = (row) => {
    if (!row) return null;
    const link = row.querySelector('a[href^="/c/"], a[href*="/c/"]');
    if (!link) return null;
    const href = link.getAttribute("href") ?? "";
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
    if (ok && row.isConnected) row.remove();
    return { attempted: true, ok };
  };
  var directArchiveConversationFromRow = async (row) => {
    const conversationId = extractConversationIdFromRow(row);
    if (!conversationId) return { attempted: false, ok: false };
    const ok = await patchConversation(conversationId, { is_archived: true });
    if (ok && row.isConnected) row.remove();
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
      intervalId: null,
      pendingByRow: /* @__PURE__ */ new Map(),
      deleteQueue: Promise.resolve()
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
      const candidates = Array.from(root.querySelectorAll('button, [role="menuitem"]'));
      return candidates.find((el) => el.textContent?.trim() === text) ?? candidates.find((el) => el.textContent?.trim().toLowerCase() === text.toLowerCase());
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
      if (document.getElementById(ONE_CLICK_DELETE_STYLE_ID)) return;
      const st = document.createElement("style");
      st.id = ONE_CLICK_DELETE_STYLE_ID;
      st.textContent = buildOneClickDeleteStyleText();
      const host = document.head ?? document.documentElement;
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
      const row = btn.closest(".group.__menu-item.hoverable");
      return row ?? null;
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
      try {
        setSilentDeleteMode(true);
        ctx.helpers.humanClick(btn, "oneclick-delete-open-menu");
        const deleteItem = await (async () => {
          const t0 = performance.now();
          while (performance.now() - t0 < 1500) {
            const menus = qsa('[role="menu"]');
            for (const menu of menus) {
              const item = menu.querySelector(
                'div[role="menuitem"][data-testid="delete-chat-menu-item"]'
              ) ?? findButtonByExactText(menu, "Delete");
              if (item) return item;
            }
            const fallback = document.querySelector(
              'div[role="menuitem"][data-testid="delete-chat-menu-item"]'
            ) ?? findButtonByExactText(document, "Delete");
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
        const confirmBtn = modal.querySelector(
          'button[data-testid="delete-conversation-confirm-button"]'
        ) ?? await waitPresent(
          'button[data-testid="delete-conversation-confirm-button"]',
          modal,
          1200
        ) ?? findButtonByExactText(modal, "Delete");
        if (!confirmBtn) return;
        ctx.helpers.humanClick(confirmBtn, "oneclick-delete-confirm");
      } finally {
        await new Promise((resolve) => setTimeout(resolve, 120));
        setSilentDeleteMode(false);
      }
    };
    const runOneClickArchiveUiFlow = async (btn) => {
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
        const confirmBtn = modal.querySelector('button[data-testid*="confirm" i]') ?? modal.querySelector('button[data-testid*="archive" i]') ?? findButtonByTextVariants(modal, confirmTexts);
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
    const getTempChatClickTarget = () => {
      const checkbox = getTempChatCheckbox();
      if (!checkbox) return null;
      return checkbox.closest("label") ?? checkbox.closest(TEMP_CHAT_LABEL_SELECTOR) ?? checkbox.closest("button") ?? checkbox;
    };
    const ensureTempChatOn = () => {
      const checkbox = getTempChatCheckbox();
      if (!checkbox) return;
      if (checkbox.disabled) return;
      if (checkbox.checked) return;
      const target = getTempChatClickTarget();
      if (!target) return;
      ctx.helpers.humanClick(target, "tempchat-enable");
      ctx.logger.debug("TEMPCHAT", "forced on");
    };
    const ensureTempChatOff = () => {
      const checkbox = getTempChatCheckbox();
      if (!checkbox) return;
      if (checkbox.disabled) return;
      if (!checkbox.checked) return;
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
        const result = state.originalPushState?.(...args);
        window.dispatchEvent(new CustomEvent(NAVIGATION_EVENT_NAME));
        return result;
      };
      history.replaceState = (...args) => {
        const result = state.originalReplaceState?.(...args);
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
      const ok2 = await ctx.helpers.waitPresent("#stage-slideover-sidebar", document, 12e3);
      if (!ok2) return false;
      const ok3 = await ctx.helpers.waitPresent('nav[aria-label="Chat history"]', document, 12e3);
      if (!ok3) return false;
      return true;
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
    const autoExpandSidebarEl = () => qs("#stage-slideover-sidebar");
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
      return sb.querySelector('nav[aria-label="Chat history"]');
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
      const btn = sec.querySelector("button.text-token-text-tertiary.flex.w-full") || sec.querySelector("button") || sec.querySelector('[role="button"]');
      if (!btn || !isElementVisible(btn)) return false;
      autoExpandDispatchClick(btn);
      return true;
    };
    const autoExpandWaitForSidebar = async () => {
      const sidebarSelector = "#stage-slideover-sidebar";
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
          'nav[aria-label="Chat history"]',
          document,
          AUTO_EXPAND_NAV_TIMEOUT_MS
        );
        if (!nav2 || runId !== state.runId || !ctx.settings.autoExpandChats) {
          if (runId === state.runId && ctx.settings.autoExpandChats) {
            ctx.logger.debug("AUTOEXPAND", "sidebar not found on start (timeout)");
          }
          return false;
        }
        const sec2 = autoExpandFindYourChatsSection(nav2);
        if (sec2 && !autoExpandSectionCollapsed(sec2)) {
          ctx.logger.debug("AUTOEXPAND", "already expanded on start");
          return true;
        }
      }
      if (!autoExpandSidebarIsOpen()) {
        autoExpandEnsureSidebarOpen();
      }
      const nav = await ctx.helpers.waitPresent(
        'nav[aria-label="Chat history"]',
        document,
        AUTO_EXPAND_NAV_TIMEOUT_MS
      );
      if (!nav || runId !== state.runId || !ctx.settings.autoExpandChats) {
        if (runId === state.runId && ctx.settings.autoExpandChats) {
          ctx.logger.debug("AUTOEXPAND", "sidebar not found on start (timeout)");
        }
        return false;
      }
      const sec = autoExpandFindYourChatsSection(nav);
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
    const findWideChatContentEl = () => document.querySelector('main [class*="max-w-(--thread-content-max-width)"]') || document.querySelector('[class*="max-w-(--thread-content-max-width)"]');
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
  var isVisible2 = (el) => el.offsetParent !== null;
  var isMainComposer = (composer) => {
    if (composer instanceof HTMLElement) {
      if (composer.id === "prompt-textarea") return true;
      if (composer.getAttribute("data-testid") === "prompt-textarea") return true;
    }
    return false;
  };
  var getHay = (btn) => {
    const aria = norm2(btn.getAttribute("aria-label"));
    const title = norm2(btn.getAttribute("title"));
    const dt = norm2(btn.getAttribute("data-testid"));
    const txt = norm2(btn.textContent);
    return `${aria} ${title} ${dt} ${txt}`.trim();
  };
  var POSITIVE = [
    "save",
    "save and submit",
    "submit",
    "apply",
    "update",
    "done",
    "ok",
    "send",
    "send message",
    "\u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C",
    "\u0441\u043E\u0445\u0440\u0430\u043D",
    "\u043F\u0440\u0438\u043C\u0435\u043D\u0438\u0442\u044C",
    "\u0433\u043E\u0442\u043E\u0432\u043E",
    "\u043E\u043A",
    "\u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C",
    "\u043E\u0442\u043F\u0440\u0430\u0432"
  ];
  var NEGATIVE = ["cancel", "close", "dismiss", "\u043E\u0442\u043C\u0435\u043D\u0430", "\u043E\u0442\u043C\u0435\u043D\u0438\u0442\u044C"];
  var isPositiveAction = (btn) => {
    if (isDisabled(btn)) return false;
    if (!isVisible2(btn)) return false;
    const hay = getHay(btn);
    if (!hay) return false;
    if (NEGATIVE.some((x) => hay.includes(x))) return false;
    return POSITIVE.some((x) => hay.includes(x));
  };
  var findEditSubmitButton = (composer) => {
    if (isMainComposer(composer)) return null;
    const closestForm = composer.closest("form");
    if (closestForm) {
      const submitBtn = closestForm.querySelector(
        'button[type="submit"], [role="button"][type="submit"]'
      );
      if (submitBtn instanceof HTMLElement && !isDisabled(submitBtn) && isVisible2(submitBtn)) {
        return submitBtn;
      }
      const formButtons = Array.from(closestForm.querySelectorAll("button, [role='button']")).filter(
        (btn) => btn instanceof HTMLElement
      );
      const byText = formButtons.find((btn) => isPositiveAction(btn));
      if (byText) return byText;
    }
    const searchRoots = [
      composer.closest('[role="dialog"], [role="alertdialog"]'),
      composer.closest("article"),
      composer.closest("[data-message-author-role]"),
      composer.closest('[data-testid*="message" i]'),
      composer.closest("div")
    ];
    const root = searchRoots.find((x) => !!x) ?? null;
    if (!root) return null;
    const buttons = Array.from(root.querySelectorAll("button, [role='button']")).filter(
      (btn) => btn instanceof HTMLElement
    );
    const candidates = buttons.filter((btn) => isPositiveAction(btn));
    if (candidates.length > 0) return candidates[0];
    const byTestId = buttons.find((btn) => {
      if (isDisabled(btn)) return false;
      if (!isVisible2(btn)) return false;
      const dt = norm2(btn.getAttribute("data-testid"));
      if (!dt) return false;
      if (dt.includes("save")) return true;
      if (dt.includes("submit")) return true;
      if (dt.includes("apply")) return true;
      if (dt.includes("update")) return true;
      if (dt.includes("send")) return true;
      return false;
    });
    return byTestId ?? null;
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
      const ap = a.combo.priority ?? 0;
      const bp = b.combo.priority ?? 0;
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
    const isVisible3 = (btn) => btn.offsetParent !== null;
    const click = (el, why) => {
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
    const readInputValue = (input) => {
      if (input instanceof HTMLTextAreaElement) return input.value || "";
      return input.innerText || input.textContent || "";
    };
    const findComposerInput = () => {
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
      return findComposerInput();
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
      if (input instanceof HTMLTextAreaElement) {
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? input.value.length;
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
    const findSendButton = (composer) => {
      const selectors = [
        '[data-testid="send-button"]',
        'button[aria-label*="Send" i]',
        '[role="button"][aria-label*="Send" i]',
        'button[aria-label="Submit"]',
        '[role="button"][aria-label="Submit"]',
        'button[aria-label*="\u041E\u0442\u043F\u0440\u0430\u0432" i]'
      ];
      const tryFindIn = (root) => {
        for (const selector of selectors) {
          const btn = root.querySelector(selector);
          if (btn instanceof HTMLElement && isVisible3(btn)) return btn;
        }
        return null;
      };
      const form = composer?.closest("form");
      if (form) {
        const inside = tryFindIn(form);
        if (inside) return inside;
        const submitBtn = form.querySelector('button[type="submit"], [role="button"][type="submit"]');
        if (submitBtn instanceof HTMLElement && isVisible3(submitBtn)) return submitBtn;
      }
      return tryFindIn(document);
    };
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
        if (!isVisible3(btn)) continue;
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
        if (!isVisible3(btn)) continue;
        if (isDisabled(btn)) continue;
        if (isSubmitDictationButton(btn)) return btn;
      }
      return null;
    };
    const waitForTextToChangeFrom = (input, baseline, timeoutMs, pollMs, onPoll) => new Promise((resolve) => {
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
    const waitForNonEmptyStableText = (input, timeoutMs, quietMs, onPoll) => new Promise((resolve) => {
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
    const waitForSendButtonReady = (composer, timeoutMs, pollMs) => new Promise((resolve) => {
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
    const waitForFinalTranscribedText = async (input, baseline) => {
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
        await waitForTextToChangeFrom(input, baseline, 4e3, 80, trySubmitDictation);
      }
      return await waitForNonEmptyStableText(input, 25e3, 450, trySubmitDictation);
    };
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
          click(editBtn, "apply-edit");
          return;
        }
        const baseline = readInputValue(target);
        const submitBtnBefore = findSubmitDictationButton();
        if (submitBtnBefore) {
          ctx.logger.debug("KEY", "CTRL+ENTER submit dictation");
          click(submitBtnBefore, "submit-dictation");
          await waitForFinalTranscribedText(target, baseline);
          const sendBtn2 = await waitForSendButtonReady(target, 12e3, 80);
          if (sendBtn2) {
            ctx.logger.debug("KEY", "CTRL+ENTER send");
            click(sendBtn2, "send");
          } else {
            ctx.logger.debug("KEY", "send button not ready");
          }
          return;
        }
        const stopBtn = findDictationStopButton();
        if (stopBtn) {
          ctx.logger.debug("KEY", "CTRL+ENTER stop dictation");
          click(stopBtn, "stop-dictation");
          await waitForFinalTranscribedText(target, baseline);
          const sendBtn2 = await waitForSendButtonReady(target, 12e3, 80);
          if (sendBtn2) {
            ctx.logger.debug("KEY", "CTRL+ENTER send");
            click(sendBtn2, "send");
          } else {
            ctx.logger.debug("KEY", "send button not ready");
          }
          return;
        }
        const sendBtn = findSendButton(target);
        if (sendBtn && !isDisabled(sendBtn)) {
          ctx.logger.debug("KEY", "CTRL+ENTER send");
          click(sendBtn, "send");
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
      const target = findActiveEditableTarget();
      const composerOk = !!target && (isComposerEventTarget(e) || shouldHandleCtrlEnterOutsideComposer());
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

  // src/application/contentScript.ts
  var fallbackStoragePort = {
    get: (defaults) => Promise.resolve({ ...defaults }),
    set: () => Promise.resolve()
  };
  var startContentScript = ({ storagePort: storagePort2 } = {}) => {
    if (window.__ChatGPTDictationAutoSendLoaded__) return;
    window.__ChatGPTDictationAutoSendLoaded__ = true;
    const resolvedStorage = storagePort2 ?? fallbackStoragePort;
    const DEBUG = false;
    const loadSettings = async () => {
      const stored = await resolvedStorage.get(SETTINGS_DEFAULTS);
      return normalizeSettings(stored);
    };
    const init = async () => {
      const settings = await loadSettings();
      const ctx = createFeatureContext({
        settings,
        storagePort: resolvedStorage,
        debugEnabled: DEBUG
      });
      const features = [
        initDictationAutoSendFeature(ctx),
        initEditLastMessageFeature(ctx),
        initAutoExpandChatsFeature(ctx),
        initAutoTempChatFeature(ctx),
        initOneClickDeleteFeature(ctx),
        initWideChatFeature(ctx),
        initCtrlEnterSendFeature(ctx)
      ];
      if (ctx.logger.isEnabled) {
        const summary = features.map((feature) => {
          const status = feature.getStatus?.();
          const state = status?.active ? "on" : "off";
          const details = status?.details ? `:${status.details}` : "";
          return `${feature.name}=${state}${details}`;
        }).join(", ");
        ctx.logger.debug("BOOT", "features initialized", { preview: summary });
      }
      const handleStorageChange = (changes, areaName) => {
        if (areaName !== "sync" && areaName !== "local") return;
        if (!changes || !("autoExpandChats" in changes) && !("autoSend" in changes) && !("allowAutoSendInCodex" in changes) && !("editLastMessageOnArrowUp" in changes) && !("autoTempChat" in changes) && !("oneClickDelete" in changes) && !("startDictation" in changes) && !("ctrlEnterSends" in changes) && !("wideChatWidth" in changes) && !("tempChatEnabled" in changes)) {
          return;
        }
        void (async () => {
          const nextSettings = await loadSettings();
          const previousSettings = { ...ctx.settings };
          Object.assign(ctx.settings, nextSettings);
          for (const handle of features) {
            handle.onSettingsChange?.(ctx.settings, previousSettings);
          }
        })();
      };
      resolvedStorage.onChanged?.(handleStorageChange);
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
  async function storageGet(defaults, storage, lastError2) {
    const areaSync = getStorageArea(storage, true);
    const areaLocal = getStorageArea(storage, false);
    const tryGet = (area) => new Promise((resolve, reject) => {
      try {
        const result = area.get(defaults, (res) => {
          const err = lastError2?.() ?? null;
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
  async function storageSet(values, storage, lastError2) {
    const areaSync = getStorageArea(storage, true);
    const areaLocal = getStorageArea(storage, false);
    const trySet = (area) => new Promise((resolve, reject) => {
      try {
        const result = area.set(values, () => {
          const err = lastError2?.() ?? null;
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
  function createStoragePort({ storageApi: storageApi2, lastError: lastError2 }) {
    const onChanged = storageApi2?.onChanged && typeof storageApi2.onChanged.addListener === "function" ? (handler) => storageApi2.onChanged?.addListener(handler) : void 0;
    return {
      get: (defaults) => storageGet(defaults, storageApi2, lastError2),
      set: (values) => storageSet(values, storageApi2, lastError2),
      onChanged
    };
  }

  // content.ts
  var storageApi = (typeof browser !== "undefined" ? browser : chrome)?.storage;
  var lastError = () => chrome?.runtime?.lastError ?? null;
  var storagePort = createStoragePort({ storageApi, lastError });
  startContentScript({ storagePort });
})();
//# sourceMappingURL=content.js.map
