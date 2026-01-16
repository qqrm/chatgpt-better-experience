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

const hintEl = mustGetElement<HTMLElement>("hint");
const selectEl = mustGetElement<HTMLSelectElement>("skipKey");
const holdEl = mustGetElement<HTMLInputElement>("holdToSend");
const allowCodexEl = mustGetElement<HTMLInputElement>("allowAutoSendInCodex");
const editLastMessageEl = mustGetElement<HTMLInputElement>("editLastMessageOnArrowUp");
const autoExpandEl = mustGetElement<HTMLInputElement>("autoExpandChats");
const autoTempChatEl = mustGetElement<HTMLInputElement>("autoTempChat");
const oneClickDeleteEl = mustGetElement<HTMLInputElement>("oneClickDelete");
const wideChatWidthEl = mustGetElement<HTMLInputElement>("wideChatWidth");
const wideChatWidthValueEl = mustGetElement<HTMLElement>("wideChatWidthValue");

const storageApi = (
  (typeof browser !== "undefined" ? browser : chrome) as { storage?: StorageApi } | undefined
)?.storage;

const lastError = () => chrome?.runtime?.lastError ?? null;

const storagePort: StoragePort = createStoragePort({ storageApi, lastError });
const popupDeps = { storagePort };

async function load() {
  const { settings, hint } = await loadPopupSettings(popupDeps);

  selectEl.value = settings.skipKey;
  holdEl.checked = settings.holdToSend;
  allowCodexEl.checked = settings.allowAutoSendInCodex;
  editLastMessageEl.checked = settings.editLastMessageOnArrowUp;
  autoExpandEl.checked = settings.autoExpandChats;
  autoTempChatEl.checked = settings.autoTempChat;
  oneClickDeleteEl.checked = settings.oneClickDelete;
  wideChatWidthEl.value = String(settings.wideChatWidth);
  wideChatWidthValueEl.textContent = `${settings.wideChatWidth}%`;

  hintEl.textContent = hint;
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
    wideChatWidth
  };

  const { hint } = await savePopupSettings(popupDeps, input);
  hintEl.textContent = hint;
  wideChatWidthValueEl.textContent = `${wideChatWidth}%`;
}

selectEl.addEventListener("change", () => void save().catch(() => {}));
holdEl.addEventListener("change", () => void save().catch(() => {}));
allowCodexEl.addEventListener("change", () => void save().catch(() => {}));
editLastMessageEl.addEventListener("change", () => void save().catch(() => {}));
autoExpandEl.addEventListener("change", () => void save().catch(() => {}));
autoTempChatEl.addEventListener("change", () => void save().catch(() => {}));
oneClickDeleteEl.addEventListener("change", () => void save().catch(() => {}));
wideChatWidthEl.addEventListener("input", () => void save().catch(() => {}));

void load().catch(() => {});
