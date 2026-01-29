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

  // src/application/popupUseCases.ts
  function buildAutoSendHint(autoSendEnabled) {
    return autoSendEnabled ? "Hold Shift while accepting dictation to skip auto-send." : "Auto-send is disabled.";
  }
  async function loadPopupSettings({ storagePort: storagePort2 }) {
    const data = await storagePort2.get(SETTINGS_DEFAULTS);
    const settings = normalizeSettings(data);
    return {
      settings,
      hint: buildAutoSendHint(settings.autoSend)
    };
  }
  async function savePopupSettings({ storagePort: storagePort2 }, input) {
    await storagePort2.set({
      ...input,
      tempChatEnabled: input.autoTempChat
    });
    return {
      hint: buildAutoSendHint(input.autoSend)
    };
  }

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
          var _a2;
          const err = (_a2 = lastError2 == null ? void 0 : lastError2()) != null ? _a2 : null;
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
          var _a2;
          const err = (_a2 = lastError2 == null ? void 0 : lastError2()) != null ? _a2 : null;
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
    const onChanged = (storageApi2 == null ? void 0 : storageApi2.onChanged) && typeof storageApi2.onChanged.addListener === "function" ? (handler) => {
      var _a2;
      return (_a2 = storageApi2.onChanged) == null ? void 0 : _a2.addListener(handler);
    } : void 0;
    return {
      get: (defaults) => storageGet(defaults, storageApi2, lastError2),
      set: (values) => storageSet(values, storageApi2, lastError2),
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

  // src/ui/popup.ts
  ensureWebExtPolyfill();
  function mustGetElement(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing element: ${id}`);
    return el;
  }
  var hintEl = mustGetElement("hint");
  var autoSendEl = mustGetElement("autoSend");
  var allowCodexEl = mustGetElement("allowAutoSendInCodex");
  var editLastMessageEl = mustGetElement("editLastMessageOnArrowUp");
  var autoExpandEl = mustGetElement("autoExpandChats");
  var autoTempChatEl = mustGetElement("autoTempChat");
  var oneClickDeleteEl = mustGetElement("oneClickDelete");
  var startDictationEl = mustGetElement("startDictation");
  var ctrlEnterSendsEl = mustGetElement("ctrlEnterSends");
  var showCompatEl = mustGetElement("showCompatibilityWarnings");
  var wideChatWidthEl = mustGetElement("wideChatWidth");
  var wideChatWidthValueEl = mustGetElement("wideChatWidthValue");
  var themeToggleEl = mustGetElement("qqrm-theme-toggle");
  var _a;
  var storageApi = (_a = typeof browser !== "undefined" ? browser : chrome) == null ? void 0 : _a.storage;
  var lastError = () => {
    var _a2, _b;
    return (_b = (_a2 = chrome == null ? void 0 : chrome.runtime) == null ? void 0 : _a2.lastError) != null ? _b : null;
  };
  var storagePort = createStoragePort({ storageApi, lastError });
  var popupDeps = { storagePort };
  var themeMediaQuery = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  var themeMode = "auto";
  var themeMediaListener = null;
  var normalizeThemeMode = (value) => value === "dark" || value === "light" || value === "auto" ? value : "auto";
  var setThemeToggleState = (mode) => {
    themeToggleEl.dataset.mode = mode;
  };
  var attachThemeMediaListener = () => {
    if (!themeMediaQuery || themeMediaListener) return;
    themeMediaListener = () => {
      if (themeMode === "auto") {
        setThemeToggleState(themeMode);
      }
    };
    if (themeMediaQuery.addEventListener) {
      themeMediaQuery.addEventListener("change", themeMediaListener);
    } else {
      themeMediaQuery.addListener(themeMediaListener);
    }
  };
  var detachThemeMediaListener = () => {
    if (!themeMediaQuery || !themeMediaListener) return;
    if (themeMediaQuery.removeEventListener) {
      themeMediaQuery.removeEventListener("change", themeMediaListener);
    } else {
      themeMediaQuery.removeListener(themeMediaListener);
    }
    themeMediaListener = null;
  };
  var applyThemeMode = (mode) => {
    themeMode = mode;
    if (mode === "auto") {
      document.documentElement.removeAttribute("data-theme");
      attachThemeMediaListener();
    } else {
      document.documentElement.dataset.theme = mode;
      detachThemeMediaListener();
    }
    setThemeToggleState(mode);
  };
  var cycleThemeMode = async () => {
    const nextMode = themeMode === "auto" ? "dark" : themeMode === "dark" ? "light" : "auto";
    await storagePort.set({ popupThemeMode: nextMode });
    applyThemeMode(nextMode);
  };
  async function load() {
    const [{ settings, hint }, themeData] = await Promise.all([
      loadPopupSettings(popupDeps),
      storagePort.get({ popupThemeMode: "auto" })
    ]);
    autoSendEl.checked = settings.autoSend;
    allowCodexEl.checked = settings.allowAutoSendInCodex;
    editLastMessageEl.checked = settings.editLastMessageOnArrowUp;
    autoExpandEl.checked = settings.autoExpandChats;
    autoTempChatEl.checked = settings.autoTempChat;
    oneClickDeleteEl.checked = settings.oneClickDelete;
    startDictationEl.checked = settings.startDictation;
    ctrlEnterSendsEl.checked = settings.ctrlEnterSends;
    showCompatEl.checked = settings.showCompatibilityWarnings;
    wideChatWidthEl.value = String(settings.wideChatWidth);
    wideChatWidthValueEl.textContent = `${settings.wideChatWidth}%`;
    hintEl.textContent = hint;
    applyThemeMode(normalizeThemeMode(themeData.popupThemeMode));
  }
  async function save() {
    const wideChatWidth = Math.min(100, Math.max(0, Number(wideChatWidthEl.value) || 0));
    const input = {
      autoSend: !!autoSendEl.checked,
      allowAutoSendInCodex: !!allowCodexEl.checked,
      editLastMessageOnArrowUp: !!editLastMessageEl.checked,
      autoExpandChats: !!autoExpandEl.checked,
      autoTempChat: !!autoTempChatEl.checked,
      oneClickDelete: !!oneClickDeleteEl.checked,
      startDictation: !!startDictationEl.checked,
      ctrlEnterSends: !!ctrlEnterSendsEl.checked,
      showCompatibilityWarnings: !!showCompatEl.checked,
      wideChatWidth
    };
    const { hint } = await savePopupSettings(popupDeps, input);
    hintEl.textContent = hint;
    wideChatWidthValueEl.textContent = `${wideChatWidth}%`;
  }
  autoSendEl.addEventListener("change", () => void save().catch(() => {
  }));
  allowCodexEl.addEventListener("change", () => void save().catch(() => {
  }));
  editLastMessageEl.addEventListener("change", () => void save().catch(() => {
  }));
  autoExpandEl.addEventListener("change", () => void save().catch(() => {
  }));
  autoTempChatEl.addEventListener("change", () => void save().catch(() => {
  }));
  oneClickDeleteEl.addEventListener("change", () => void save().catch(() => {
  }));
  startDictationEl.addEventListener("change", () => void save().catch(() => {
  }));
  ctrlEnterSendsEl.addEventListener("change", () => void save().catch(() => {
  }));
  showCompatEl.addEventListener("change", () => void save().catch(() => {
  }));
  wideChatWidthEl.addEventListener("input", () => void save().catch(() => {
  }));
  themeToggleEl.addEventListener("click", () => void cycleThemeMode().catch(() => {
  }));
  void load().catch(() => {
  });
})();
//# sourceMappingURL=popup.js.map
