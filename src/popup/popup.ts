import { loadPopupSettings, savePopupSettings } from "../application/popupUseCases";
import { StoragePort } from "../domain/ports/storagePort";
import { StorageApi, createStoragePort } from "../infra/storageAdapter";

function mustGetElement<T extends HTMLElement>(id: string) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: ${id}`);
  return el as T;
}

type ThemeMode = "auto" | "dark" | "light";
type PopupTab = "automation" | "input" | "sidebar" | "performance" | "codex" | "dev";

const autoSendEl = mustGetElement<HTMLInputElement>("autoSend");
const allowCodexEl = mustGetElement<HTMLInputElement>("allowAutoSendInCodex");
const showMessageTimestampsEl = mustGetElement<HTMLInputElement>("showMessageTimestamps");
const preserveReadingPositionOnSendEl = mustGetElement<HTMLInputElement>(
  "preserveReadingPositionOnSend"
);
const downloadGitPatchesWithShiftClickEl = mustGetElement<HTMLInputElement>(
  "downloadGitPatchesWithShiftClick"
);
const editLastMessageEl = mustGetElement<HTMLInputElement>("editLastMessageOnArrowUp");
const renameChatOnF2El = mustGetElement<HTMLInputElement>("renameChatOnF2");
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
const macroRecorderControlEl = mustGetElement<HTMLElement>("macroRecorderControl");
const debugAutoExpandProjectsEl = mustGetElement<HTMLInputElement>("debugAutoExpandProjects");
const debugTraceTargetEl = mustGetElement<HTMLSelectElement>("debugTraceTarget");
const debugTracesControlEl = mustGetElement<HTMLElement>("debugTracesControl");
const devPanelEnabledEl = mustGetElement<HTMLInputElement>("devPanelEnabled");
const panelContainerEl = mustGetElement<HTMLElement>("panelContainer");
const tabBarEl = document.querySelector<HTMLElement>(".tabBar");

const popupTabs: PopupTab[] = ["automation", "input", "sidebar", "performance", "codex", "dev"];
const tabButtonEls: Record<PopupTab, HTMLButtonElement> = {
  automation: mustGetElement<HTMLButtonElement>("tab-automation"),
  input: mustGetElement<HTMLButtonElement>("tab-input"),
  sidebar: mustGetElement<HTMLButtonElement>("tab-sidebar"),
  performance: mustGetElement<HTMLButtonElement>("tab-performance"),
  codex: mustGetElement<HTMLButtonElement>("tab-codex"),
  dev: mustGetElement<HTMLButtonElement>("tab-dev")
};
const tabPanelEls: Record<PopupTab, HTMLElement> = {
  automation: mustGetElement<HTMLElement>("panel-automation"),
  input: mustGetElement<HTMLElement>("panel-input"),
  sidebar: mustGetElement<HTMLElement>("panel-sidebar"),
  performance: mustGetElement<HTMLElement>("panel-performance"),
  codex: mustGetElement<HTMLElement>("panel-codex"),
  dev: mustGetElement<HTMLElement>("panel-dev")
};

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
let panelHeightMeasureRafId: number | null = null;

const normalizeThemeMode = (value: unknown): ThemeMode =>
  value === "dark" || value === "light" || value === "auto" ? value : "auto";

const normalizePopupTab = (value: unknown): PopupTab =>
  popupTabs.includes(value as PopupTab) ? (value as PopupTab) : "automation";

const setThemeToggleState = (mode: ThemeMode) => {
  themeToggleEl.dataset.mode = mode;
};

const setActiveTab = async (tab: PopupTab, persist = true) => {
  for (const popupTab of popupTabs) {
    const isActive = popupTab === tab;
    const button = tabButtonEls[popupTab];
    const panel = tabPanelEls[popupTab];

    button.setAttribute("aria-selected", isActive ? "true" : "false");
    button.tabIndex = isActive ? 0 : -1;
    panel.classList.toggle("isActive", isActive);
    panel.style.display = isActive ? "" : "none";
    panel.setAttribute("aria-hidden", isActive ? "false" : "true");
  }

  if (persist) {
    await storagePort.set({ popupActiveTab: tab });
  }
  schedulePanelHeightLock();
};

const measureMaxPanelHeightAndLock = () => {
  const panelContainerWidth = panelContainerEl.clientWidth;
  let maxHeight = 0;

  for (const panel of Object.values(tabPanelEls)) {
    const prevDisplay = panel.style.display;
    const prevPosition = panel.style.position;
    const prevVisibility = panel.style.visibility;
    const prevPointerEvents = panel.style.pointerEvents;
    const prevLeft = panel.style.left;
    const prevTop = panel.style.top;
    const prevWidth = panel.style.width;

    panel.style.display = "block";
    panel.style.position = "absolute";
    panel.style.visibility = "hidden";
    panel.style.pointerEvents = "none";
    panel.style.left = "-10000px";
    panel.style.top = "0";
    panel.style.width = `${panelContainerWidth}px`;

    maxHeight = Math.max(maxHeight, panel.scrollHeight);

    panel.style.display = prevDisplay;
    panel.style.position = prevPosition;
    panel.style.visibility = prevVisibility;
    panel.style.pointerEvents = prevPointerEvents;
    panel.style.left = prevLeft;
    panel.style.top = prevTop;
    panel.style.width = prevWidth;
  }

  panelContainerEl.style.height = `${maxHeight}px`;
  panelContainerEl.style.overflowY = "auto";
};

const schedulePanelHeightLock = () => {
  if (panelHeightMeasureRafId !== null) {
    window.cancelAnimationFrame(panelHeightMeasureRafId);
  }
  panelHeightMeasureRafId = window.requestAnimationFrame(() => {
    panelHeightMeasureRafId = null;
    measureMaxPanelHeightAndLock();
  });
};

const attachThemeMediaListener = () => {
  if (!themeMediaQuery || themeMediaListener) return;
  themeMediaListener = () => {
    if (themeMode === "auto") {
      setThemeToggleState(themeMode);
      schedulePanelHeightLock();
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
  schedulePanelHeightLock();
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

function renderMacroRecorderStatus(status: unknown, _lastExportAt: unknown) {
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
  macroRecorderMetaEl.textContent = "Ctrl/Cmd+Shift+F8 toggle";
}

const setDebugTraceTargetVisible = (visible: boolean) => {
  debugTraceTargetEl.style.display = visible ? "" : "none";
  schedulePanelHeightLock();
};

const updateDeveloperControlsVisibility = () => {
  const isDeveloperMode = !!devPanelEnabledEl.checked;
  macroRecorderControlEl.style.display = isDeveloperMode ? "" : "none";
  debugTracesControlEl.style.display = isDeveloperMode ? "" : "none";
  setDebugTraceTargetVisible(isDeveloperMode && !!debugAutoExpandProjectsEl.checked);
};

const forceDisableHiddenDevFeatures = async () => {
  macroRecorderEnabledEl.checked = false;
  debugAutoExpandProjectsEl.checked = false;
  renderMacroRecorderStatus("off", undefined);
  setDebugTraceTargetVisible(false);
  await storagePort.set({ macroRecorderEnabled: false, debugAutoExpandProjects: false });
};

async function load() {
  const [{ settings }, themeData, macroData, devData, tabData] = await Promise.all([
    loadPopupSettings(popupDeps),
    storagePort.get({ popupThemeMode: "auto" as ThemeMode }),
    storagePort.get({ macroRecorderStatus: "off", macroRecorderLastExportAt: 0 }),
    storagePort.get({ popupDevPanelEnabled: false }),
    storagePort.get({ popupActiveTab: "automation" as PopupTab })
  ]);

  autoSendEl.checked = settings.autoSend;
  allowCodexEl.checked = settings.allowAutoSendInCodex;
  showMessageTimestampsEl.checked = settings.showMessageTimestamps;
  preserveReadingPositionOnSendEl.checked = settings.preserveReadingPositionOnSend;
  downloadGitPatchesWithShiftClickEl.checked = settings.downloadGitPatchesWithShiftClick;
  editLastMessageEl.checked = settings.editLastMessageOnArrowUp;
  renameChatOnF2El.checked = settings.renameChatOnF2;
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
  debugAutoExpandProjectsEl.checked = !!settings.debugAutoExpandProjects;
  debugTraceTargetEl.value = settings.debugTraceTarget;
  devPanelEnabledEl.checked = !!devData.popupDevPanelEnabled;

  if (!devPanelEnabledEl.checked) {
    await forceDisableHiddenDevFeatures();
  }

  updateDeveloperControlsVisibility();
  renderMacroRecorderStatus(macroData.macroRecorderStatus, macroData.macroRecorderLastExportAt);
  applyThemeMode(normalizeThemeMode(themeData.popupThemeMode));
  await setActiveTab(normalizePopupTab(tabData.popupActiveTab), false);
  schedulePanelHeightLock();
}

async function save() {
  const wideChatWidth = Math.min(100, Math.max(0, Number(wideChatWidthEl.value) || 0));
  const trimChatDomKeep = Math.min(50, Math.max(5, Number(trimChatDomKeepEl.value) || 0));

  const debugTraceTarget: "projects" | "editMessage" | "autoSend" | "timestamps" =
    debugTraceTargetEl.value === "editMessage"
      ? "editMessage"
      : debugTraceTargetEl.value === "autoSend"
        ? "autoSend"
        : debugTraceTargetEl.value === "timestamps"
          ? "timestamps"
          : "projects";

  const input = {
    autoSend: !!autoSendEl.checked,
    allowAutoSendInCodex: !!allowCodexEl.checked,
    showMessageTimestamps: !!showMessageTimestampsEl.checked,
    preserveReadingPositionOnSend: !!preserveReadingPositionOnSendEl.checked,
    downloadGitPatchesWithShiftClick: !!downloadGitPatchesWithShiftClickEl.checked,
    clearClipboardAfterShiftDownload: true,
    editLastMessageOnArrowUp: !!editLastMessageEl.checked,
    renameChatOnF2: !!renameChatOnF2El.checked,
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
    macroRecorderEnabled: !!devPanelEnabledEl.checked && !!macroRecorderEnabledEl.checked,
    debugAutoExpandProjects: !!devPanelEnabledEl.checked && !!debugAutoExpandProjectsEl.checked,
    debugTraceTarget
  };

  await savePopupSettings(popupDeps, input);
  trimChatDomKeepValueEl.textContent = String(trimChatDomKeep);
  wideChatWidthValueEl.textContent = `${wideChatWidth}%`;
}

for (const tab of popupTabs) {
  tabButtonEls[tab].addEventListener("click", () => {
    void setActiveTab(tab)
      .then(schedulePanelHeightLock)
      .catch(() => {});
  });
}

tabBarEl?.addEventListener("wheel", (event) => {
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
    return;
  }
  tabBarEl.scrollLeft += event.deltaY;
  event.preventDefault();
});

autoSendEl.addEventListener("change", () => void save().catch(() => {}));
allowCodexEl.addEventListener("change", () => void save().catch(() => {}));
showMessageTimestampsEl.addEventListener("change", () => void save().catch(() => {}));
preserveReadingPositionOnSendEl.addEventListener("change", () => void save().catch(() => {}));
downloadGitPatchesWithShiftClickEl.addEventListener("change", () => void save().catch(() => {}));
editLastMessageEl.addEventListener("change", () => void save().catch(() => {}));
renameChatOnF2El.addEventListener("change", () => void save().catch(() => {}));
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
debugAutoExpandProjectsEl.addEventListener("change", () => {
  updateDeveloperControlsVisibility();
  schedulePanelHeightLock();
  void save().catch(() => {});
});
debugTraceTargetEl.addEventListener("change", () => {
  schedulePanelHeightLock();
  void save().catch(() => {});
});
devPanelEnabledEl.addEventListener("change", () => {
  const isDeveloperMode = !!devPanelEnabledEl.checked;
  updateDeveloperControlsVisibility();
  schedulePanelHeightLock();
  void storagePort.set({ popupDevPanelEnabled: isDeveloperMode }).catch(() => {});
  if (!isDeveloperMode) {
    void forceDisableHiddenDevFeatures().catch(() => {});
  }
});
window.addEventListener("resize", schedulePanelHeightLock);

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
      if (!devPanelEnabledEl.checked && next) {
        void forceDisableHiddenDevFeatures().catch(() => {});
        return;
      }
      macroRecorderEnabledEl.checked = next;
      if (!next) {
        renderMacroRecorderStatus("off", undefined);
      }
    }
  }

  if ("debugAutoExpandProjects" in changes) {
    const next = changes.debugAutoExpandProjects?.newValue;
    if (typeof next === "boolean") {
      if (!devPanelEnabledEl.checked && next) {
        void forceDisableHiddenDevFeatures().catch(() => {});
        return;
      }
      debugAutoExpandProjectsEl.checked = next;
      updateDeveloperControlsVisibility();
    }
  }

  if ("debugTraceTarget" in changes) {
    const next = changes.debugTraceTarget?.newValue;
    if (
      next === "projects" ||
      next === "editMessage" ||
      next === "autoSend" ||
      next === "timestamps"
    ) {
      debugTraceTargetEl.value = next;
    }
  }

  if ("popupDevPanelEnabled" in changes) {
    const next = changes.popupDevPanelEnabled?.newValue;
    if (typeof next === "boolean") {
      devPanelEnabledEl.checked = next;
      updateDeveloperControlsVisibility();
      schedulePanelHeightLock();
      if (!next) {
        void forceDisableHiddenDevFeatures().catch(() => {});
      }
    }
  }

  if ("popupActiveTab" in changes) {
    const next = normalizePopupTab(changes.popupActiveTab?.newValue);
    void setActiveTab(next, false)
      .then(schedulePanelHeightLock)
      .catch(() => {});
  }
});

void load().catch(() => {});
