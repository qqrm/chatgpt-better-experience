import { loadPopupSettings, savePopupSettings } from "./src/application/popupUseCases";
import { StoragePort } from "./src/domain/ports/storagePort";
import { StorageApi, createStoragePort } from "./src/infra/storageAdapter";

declare const chrome: {
  runtime?: { lastError?: unknown };
  storage?: StorageApi;
};

declare const browser: {
  storage?: StorageApi;
};

function mustGetElement<T extends HTMLElement>(id: string) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: ${id}`);
  return el as T;
}

type ThemeMode = "auto" | "dark" | "light";

const hintEl = mustGetElement<HTMLElement>("hint");
const selectEl = mustGetElement<HTMLSelectElement>("skipKey");
const holdEl = mustGetElement<HTMLInputElement>("holdToSend");
const allowCodexEl = mustGetElement<HTMLInputElement>("allowAutoSendInCodex");
const editLastMessageEl = mustGetElement<HTMLInputElement>("editLastMessageOnArrowUp");
const autoExpandEl = mustGetElement<HTMLInputElement>("autoExpandChats");
const autoTempChatEl = mustGetElement<HTMLInputElement>("autoTempChat");
const oneClickDeleteEl = mustGetElement<HTMLInputElement>("oneClickDelete");
const startDictationEl = mustGetElement<HTMLInputElement>("startDictation");
const ctrlEnterSendsEl = mustGetElement<HTMLInputElement>("ctrlEnterSends");
const wideChatWidthEl = mustGetElement<HTMLInputElement>("wideChatWidth");
const wideChatWidthValueEl = mustGetElement<HTMLElement>("wideChatWidthValue");
const dictationHintEl = mustGetElement<HTMLElement>("dictationHint");
const ctrlEnterHintEl = mustGetElement<HTMLElement>("ctrlEnterHint");
const themeToggleEl = mustGetElement<HTMLButtonElement>("qqrm-theme-toggle");

const storageApi = (
  (typeof browser !== "undefined" ? browser : chrome) as { storage?: StorageApi } | undefined
)?.storage;

const lastError = () => chrome?.runtime?.lastError ?? null;

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

async function load() {
  const [{ settings, hint }, themeData] = await Promise.all([
    loadPopupSettings(popupDeps),
    storagePort.get({ popupThemeMode: "auto" as ThemeMode })
  ]);

  selectEl.value = settings.skipKey;
  holdEl.checked = settings.holdToSend;
  allowCodexEl.checked = settings.allowAutoSendInCodex;
  editLastMessageEl.checked = settings.editLastMessageOnArrowUp;
  autoExpandEl.checked = settings.autoExpandChats;
  autoTempChatEl.checked = settings.autoTempChat;
  oneClickDeleteEl.checked = settings.oneClickDelete;
  startDictationEl.checked = settings.startDictation;
  ctrlEnterSendsEl.checked = settings.ctrlEnterSends;
  wideChatWidthEl.value = String(settings.wideChatWidth);
  wideChatWidthValueEl.textContent = `${settings.wideChatWidth}%`;

  hintEl.textContent = hint;
  dictationHintEl.hidden = !settings.startDictation;
  ctrlEnterHintEl.hidden = !settings.ctrlEnterSends;

  applyThemeMode(normalizeThemeMode(themeData.popupThemeMode));
}

async function save() {
  const wideChatWidth = Math.min(100, Math.max(0, Number(wideChatWidthEl.value) || 0));
  const input = {
    skipKey: selectEl.value,
    holdToSend: !!holdEl.checked,
    allowAutoSendInCodex: !!allowCodexEl.checked,
    editLastMessageOnArrowUp: !!editLastMessageEl.checked,
    autoExpandChats: !!autoExpandEl.checked,
    autoTempChat: !!autoTempChatEl.checked,
    oneClickDelete: !!oneClickDeleteEl.checked,
    startDictation: !!startDictationEl.checked,
    ctrlEnterSends: !!ctrlEnterSendsEl.checked,
    wideChatWidth
  };

  const { hint } = await savePopupSettings(popupDeps, input);
  hintEl.textContent = hint;
  dictationHintEl.hidden = !startDictationEl.checked;
  ctrlEnterHintEl.hidden = !ctrlEnterSendsEl.checked;
  wideChatWidthValueEl.textContent = `${wideChatWidth}%`;
}

selectEl.addEventListener("change", () => void save().catch(() => {}));
holdEl.addEventListener("change", () => void save().catch(() => {}));
allowCodexEl.addEventListener("change", () => void save().catch(() => {}));
editLastMessageEl.addEventListener("change", () => void save().catch(() => {}));
autoExpandEl.addEventListener("change", () => void save().catch(() => {}));
autoTempChatEl.addEventListener("change", () => void save().catch(() => {}));
oneClickDeleteEl.addEventListener("change", () => void save().catch(() => {}));
startDictationEl.addEventListener("change", () => void save().catch(() => {}));
ctrlEnterSendsEl.addEventListener("change", () => void save().catch(() => {}));
wideChatWidthEl.addEventListener("input", () => void save().catch(() => {}));
themeToggleEl.addEventListener("click", () => void cycleThemeMode().catch(() => {}));

void load().catch(() => {});
