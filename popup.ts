import { loadPopupSettings, savePopupSettings } from "./src/application/popupUseCases";
import { StoragePort } from "./src/domain/ports/storagePort";
import { StorageApi, createStoragePort } from "./src/infra/storageAdapter";

function mustGetElement<T extends HTMLElement>(id: string) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: ${id}`);
  return el as T;
}

type ThemeMode = "auto" | "dark" | "light";

const autoSendEl = mustGetElement<HTMLInputElement>("autoSend");
const allowCodexEl = mustGetElement<HTMLInputElement>("allowAutoSendInCodex");
const editLastMessageEl = mustGetElement<HTMLInputElement>("editLastMessageOnArrowUp");
const autoExpandEl = mustGetElement<HTMLInputElement>("autoExpandChats");
const autoExpandProjectsEl = mustGetElement<HTMLInputElement>("autoExpandProjects");
const autoExpandProjectItemsEl = mustGetElement<HTMLInputElement>("autoExpandProjectItems");
const autoTempChatEl = mustGetElement<HTMLInputElement>("autoTempChat");
const oneClickDeleteEl = mustGetElement<HTMLInputElement>("oneClickDelete");
const startDictationEl = mustGetElement<HTMLInputElement>("startDictation");
const ctrlEnterSendsEl = mustGetElement<HTMLInputElement>("ctrlEnterSends");
const trimChatDomEl = mustGetElement<HTMLInputElement>("trimChatDom");
const trimChatDomKeepEl = mustGetElement<HTMLInputElement>("trimChatDomKeep");
const trimChatDomKeepValueEl = mustGetElement<HTMLElement>("trimChatDomKeepValue");
const trimChatDomKeepRowLabelEl = mustGetElement<HTMLElement>("trimChatDomKeepRowLabel");
const trimChatDomKeepRowRangeEl = mustGetElement<HTMLElement>("trimChatDomKeepRowRange");
const trimChatDomHintEl = mustGetElement<HTMLElement>("trimChatDomHint");
const hideShareButtonEl = mustGetElement<HTMLInputElement>("hideShareButton");
const wideChatWidthEl = mustGetElement<HTMLInputElement>("wideChatWidth");
const wideChatWidthValueEl = mustGetElement<HTMLElement>("wideChatWidthValue");
const themeToggleEl = mustGetElement<HTMLButtonElement>("qqrm-theme-toggle");
const macroRecorderEnabledEl = mustGetElement<HTMLInputElement>("macroRecorderEnabled");
const macroRecorderStatusEl = mustGetElement<HTMLElement>("macroRecorderStatus");
const macroRecorderMetaEl = mustGetElement<HTMLElement>("macroRecorderMeta");

type ExtensionLike = {
  runtime?: { lastError?: unknown };
  storage?: StorageApi;
};

const extensionApi =
  (globalThis as typeof globalThis & { browser?: ExtensionLike; chrome?: ExtensionLike }).browser ??
  (globalThis as typeof globalThis & { browser?: ExtensionLike; chrome?: ExtensionLike }).chrome;

const storageApi = extensionApi?.storage;

const lastError = () => extensionApi?.runtime?.lastError ?? null;

const storagePort: StoragePort = createStoragePort({ storageApi, lastError });
const popupDeps = { storagePort };

const themeMediaQuery =
  typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
let themeMode: ThemeMode = "auto";
let themeMediaListener: ((event: MediaQueryListEvent) => void) | null = null;

const normalizeThemeMode = (value: unknown): ThemeMode =>
  value === "dark" || value === "light" || value === "auto" ? value : "auto";

const setThemeToggleState = (mode: ThemeMode) => {
  themeToggleEl.dataset.mode = mode;
};

const attachThemeMediaListener = () => {
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

const detachThemeMediaListener = () => {
  if (!themeMediaQuery || !themeMediaListener) return;
  if (themeMediaQuery.removeEventListener) {
    themeMediaQuery.removeEventListener("change", themeMediaListener);
  } else {
    themeMediaQuery.removeListener(themeMediaListener);
  }
  themeMediaListener = null;
};

const applyThemeMode = (mode: ThemeMode) => {
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

const cycleThemeMode = async () => {
  const nextMode = themeMode === "auto" ? "dark" : themeMode === "dark" ? "light" : "auto";
  await storagePort.set({ popupThemeMode: nextMode });
  applyThemeMode(nextMode);
};

const setTrimChatKeepVisible = (visible: boolean) => {
  const d = visible ? "" : "none";
  trimChatDomKeepRowLabelEl.style.display = d;
  trimChatDomKeepRowRangeEl.style.display = d;
  trimChatDomHintEl.style.display = d;
};

type MacroRecorderRuntimeStatus = "off" | "armed" | "recording" | "ready";

function renderMacroRecorderStatus(status: unknown, lastExportAt: unknown) {
  const value: MacroRecorderRuntimeStatus =
    status === "armed" || status === "recording" || status === "ready" ? status : "off";

  macroRecorderStatusEl.textContent =
    value === "recording"
      ? "Recording"
      : value === "armed"
        ? "Armed"
        : value === "ready"
          ? "Ready"
          : "Off";

  const ts =
    typeof lastExportAt === "number" && Number.isFinite(lastExportAt) && lastExportAt > 0
      ? new Date(lastExportAt).toLocaleTimeString()
      : "";

  macroRecorderMetaEl.textContent = ts
    ? `Ctrl/Cmd+Shift+F8 toggle (last: ${ts})`
    : "Ctrl/Cmd+Shift+F8 toggle";
}

async function load() {
  const [{ settings }, themeData, macroData] = await Promise.all([
    loadPopupSettings(popupDeps),
    storagePort.get({ popupThemeMode: "auto" as ThemeMode }),
    storagePort.get({ macroRecorderStatus: "off", macroRecorderLastExportAt: 0 })
  ]);

  autoSendEl.checked = settings.autoSend;
  allowCodexEl.checked = settings.allowAutoSendInCodex;
  editLastMessageEl.checked = settings.editLastMessageOnArrowUp;
  autoExpandEl.checked = settings.autoExpandChats;
  autoExpandProjectsEl.checked = settings.autoExpandProjects;
  autoExpandProjectItemsEl.checked = settings.autoExpandProjectItems;
  autoTempChatEl.checked = settings.autoTempChat;
  oneClickDeleteEl.checked = settings.oneClickDelete;
  startDictationEl.checked = settings.startDictation;
  ctrlEnterSendsEl.checked = settings.ctrlEnterSends;
  trimChatDomEl.checked = settings.trimChatDom;
  trimChatDomKeepEl.value = String(settings.trimChatDomKeep);
  trimChatDomKeepValueEl.textContent = String(settings.trimChatDomKeep);
  setTrimChatKeepVisible(settings.trimChatDom);
  hideShareButtonEl.checked = settings.hideShareButton;
  wideChatWidthEl.value = String(settings.wideChatWidth);
  wideChatWidthValueEl.textContent = `${settings.wideChatWidth}%`;

  macroRecorderEnabledEl.checked = !!settings.macroRecorderEnabled;
  renderMacroRecorderStatus(macroData.macroRecorderStatus, macroData.macroRecorderLastExportAt);

  applyThemeMode(normalizeThemeMode(themeData.popupThemeMode));
}

async function save() {
  const wideChatWidth = Math.min(100, Math.max(0, Number(wideChatWidthEl.value) || 0));
  const trimChatDomKeep = Math.min(50, Math.max(5, Number(trimChatDomKeepEl.value) || 0));

  const input = {
    autoSend: !!autoSendEl.checked,
    allowAutoSendInCodex: !!allowCodexEl.checked,
    editLastMessageOnArrowUp: !!editLastMessageEl.checked,
    autoExpandChats: !!autoExpandEl.checked,
    autoExpandProjects: !!autoExpandProjectsEl.checked,
    autoExpandProjectItems: !!autoExpandProjectItemsEl.checked,
    autoTempChat: !!autoTempChatEl.checked,
    oneClickDelete: !!oneClickDeleteEl.checked,
    startDictation: !!startDictationEl.checked,
    ctrlEnterSends: !!ctrlEnterSendsEl.checked,
    trimChatDom: !!trimChatDomEl.checked,
    trimChatDomKeep,
    hideShareButton: !!hideShareButtonEl.checked,
    wideChatWidth,
    macroRecorderEnabled: !!macroRecorderEnabledEl.checked
  };

  await savePopupSettings(popupDeps, input);
  trimChatDomKeepValueEl.textContent = String(trimChatDomKeep);
  wideChatWidthValueEl.textContent = `${wideChatWidth}%`;
}

autoSendEl.addEventListener("change", () => void save().catch(() => {}));
allowCodexEl.addEventListener("change", () => void save().catch(() => {}));
editLastMessageEl.addEventListener("change", () => void save().catch(() => {}));
autoExpandEl.addEventListener("change", () => void save().catch(() => {}));
autoExpandProjectsEl.addEventListener("change", () => void save().catch(() => {}));
autoExpandProjectItemsEl.addEventListener("change", () => void save().catch(() => {}));
autoTempChatEl.addEventListener("change", () => void save().catch(() => {}));
oneClickDeleteEl.addEventListener("change", () => void save().catch(() => {}));
startDictationEl.addEventListener("change", () => void save().catch(() => {}));
ctrlEnterSendsEl.addEventListener("change", () => void save().catch(() => {}));
trimChatDomEl.addEventListener("change", () => {
  setTrimChatKeepVisible(!!trimChatDomEl.checked);
  void save().catch(() => {});
});
trimChatDomKeepEl.addEventListener("input", () => void save().catch(() => {}));
hideShareButtonEl.addEventListener("change", () => void save().catch(() => {}));
wideChatWidthEl.addEventListener("input", () => void save().catch(() => {}));
themeToggleEl.addEventListener("click", () => void cycleThemeMode().catch(() => {}));
macroRecorderEnabledEl.addEventListener("change", () => void save().catch(() => {}));

storagePort.onChanged?.((changes) => {
  if ("macroRecorderStatus" in changes || "macroRecorderLastExportAt" in changes) {
    renderMacroRecorderStatus(
      changes.macroRecorderStatus?.newValue,
      "macroRecorderLastExportAt" in changes
        ? changes.macroRecorderLastExportAt?.newValue
        : undefined
    );
  }

  if ("macroRecorderEnabled" in changes) {
    const next = changes.macroRecorderEnabled?.newValue;
    if (typeof next === "boolean") {
      macroRecorderEnabledEl.checked = next;
      if (!next) {
        renderMacroRecorderStatus("off", undefined);
      }
    }
  }
});

void load().catch(() => {});
