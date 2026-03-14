import {
  buildPopupSelectiveProjectOptions,
  loadPopupSelectiveProjects,
  loadPopupSettings,
  savePopupSelectiveProjectsPrefs,
  savePopupSettings,
  upsertPopupSelectiveProjectPref
} from "../application/popupUseCases";
import {
  AUTO_EXPAND_PROJECTS_PREFS_KEY,
  AUTO_EXPAND_PROJECTS_REGISTRY_KEY,
  AutoExpandProjectsPrefs,
  AutoExpandProjectsRegistry,
  Settings
} from "../domain/settings";
import { StoragePort } from "../domain/ports/storagePort";
import {
  normalizeAutoExpandProjectsPrefs,
  normalizeAutoExpandProjectsRegistry,
  normalizeSettings
} from "../lib/utils";

function mustGetElement<T extends HTMLElement>(doc: Document, id: string) {
  const el = doc.getElementById(id);
  if (!el) throw new Error(`Missing element: ${id}`);
  return el as T;
}

type ThemeMode = "auto" | "dark" | "light";
type PopupTab = "automation" | "input" | "sidebar" | "performance" | "codex" | "dev";
type DrawerId = "trimChatDom" | "wideChat";
type MacroRecorderRuntimeStatus = "off" | "armed" | "recording" | "ready";
type PopupPreviewState = {
  settings?: Partial<Settings>;
  registry?: AutoExpandProjectsRegistry;
  prefs?: AutoExpandProjectsPrefs;
  popupThemeMode?: ThemeMode;
  popupActiveTab?: PopupTab;
  forceAutoExpandProjectsDropdownOpen?: boolean;
};

const DRAWER_AUTO_CLOSE_MS = 5 * 60 * 1000;
const SELECTIVE_PROJECTS_DROPDOWN_AUTO_HIDE_MS = 5 * 60 * 1000;
const SELECTIVE_PROJECTS_ACTIVITY_EVENTS = [
  "click",
  "pointerdown",
  "input",
  "change",
  "focusin",
  "keydown",
  "wheel",
  "scroll"
] as const;
const DRAWER_STORAGE_KEYS = {
  trimChatDom: "popupTrimChatDomDetailsOpenUntil",
  wideChat: "popupWideChatDetailsOpenUntil"
} as const;

declare global {
  interface Window {
    __CBE_POPUP_PREVIEW__?: PopupPreviewState;
  }
}

export interface PopupControllerDeps {
  storagePort: StoragePort;
  document?: Document;
  window?: Window & typeof globalThis;
  now?: () => number;
}

export interface PopupController {
  dispose(): void;
}

interface PopupElements {
  autoSendEl: HTMLInputElement;
  allowCodexEl: HTMLInputElement;
  showMessageTimestampsEl: HTMLInputElement;
  preserveReadingPositionOnSendEl: HTMLInputElement;
  downloadGitPatchesWithShiftClickEl: HTMLInputElement;
  editLastMessageEl: HTMLInputElement;
  renameChatOnF2El: HTMLInputElement;
  autoExpandEl: HTMLInputElement;
  autoExpandProjectsEl: HTMLInputElement;
  autoExpandProjectItemsEl: HTMLInputElement;
  autoExpandProjectItemsRevealEl: HTMLButtonElement;
  autoExpandProjectItemsDropdownEl: HTMLElement;
  autoExpandProjectItemsListEl: HTMLElement;
  autoTempChatEl: HTMLInputElement;
  oneClickDeleteEl: HTMLInputElement;
  startDictationEl: HTMLInputElement;
  ctrlEnterSendsEl: HTMLInputElement;
  trimChatDomEl: HTMLInputElement;
  trimChatDomKeepEl: HTMLInputElement;
  trimChatDomKeepValueEl: HTMLElement;
  trimChatDomDetailsEl: HTMLElement;
  trimChatDomDetailsButtonEl: HTMLButtonElement;
  hideShareButtonEl: HTMLInputElement;
  wideChatWidthEl: HTMLInputElement;
  wideChatDetailsEl: HTMLElement;
  wideChatDetailsButtonEl: HTMLButtonElement;
  themeToggleEl: HTMLButtonElement;
  macroRecorderEnabledEl: HTMLInputElement;
  macroRecorderStatusEl: HTMLElement;
  macroRecorderMetaEl: HTMLElement;
  macroRecorderControlEl: HTMLElement;
  debugAutoExpandProjectsEl: HTMLInputElement;
  debugTraceTargetEl: HTMLSelectElement;
  debugTracesControlEl: HTMLElement;
  devPanelEnabledEl: HTMLInputElement;
  panelContainerEl: HTMLElement;
  tabBarEl: HTMLElement | null;
  tabButtonEls: Record<PopupTab, HTMLButtonElement>;
  tabPanelEls: Record<PopupTab, HTMLElement>;
}

const popupTabs: PopupTab[] = ["automation", "input", "sidebar", "performance", "codex", "dev"];

const normalizeThemeMode = (value: unknown): ThemeMode =>
  value === "dark" || value === "light" || value === "auto" ? value : "auto";

const normalizePopupTab = (value: unknown): PopupTab =>
  popupTabs.includes(value as PopupTab) ? (value as PopupTab) : "automation";

const normalizeDrawerDeadline = (value: unknown, now: number): number =>
  typeof value === "number" && Number.isFinite(value) && value > now ? Math.floor(value) : 0;

const drawerStorageKey = (drawer: DrawerId) => DRAWER_STORAGE_KEYS[drawer];

const getPopupElements = (doc: Document): PopupElements => ({
  autoSendEl: mustGetElement<HTMLInputElement>(doc, "autoSend"),
  allowCodexEl: mustGetElement<HTMLInputElement>(doc, "allowAutoSendInCodex"),
  showMessageTimestampsEl: mustGetElement<HTMLInputElement>(doc, "showMessageTimestamps"),
  preserveReadingPositionOnSendEl: mustGetElement<HTMLInputElement>(
    doc,
    "preserveReadingPositionOnSend"
  ),
  downloadGitPatchesWithShiftClickEl: mustGetElement<HTMLInputElement>(
    doc,
    "downloadGitPatchesWithShiftClick"
  ),
  editLastMessageEl: mustGetElement<HTMLInputElement>(doc, "editLastMessageOnArrowUp"),
  renameChatOnF2El: mustGetElement<HTMLInputElement>(doc, "renameChatOnF2"),
  autoExpandEl: mustGetElement<HTMLInputElement>(doc, "autoExpandChats"),
  autoExpandProjectsEl: mustGetElement<HTMLInputElement>(doc, "autoExpandProjects"),
  autoExpandProjectItemsEl: mustGetElement<HTMLInputElement>(doc, "autoExpandProjectItems"),
  autoExpandProjectItemsRevealEl: mustGetElement<HTMLButtonElement>(
    doc,
    "autoExpandProjectItemsReveal"
  ),
  autoExpandProjectItemsDropdownEl: mustGetElement<HTMLElement>(
    doc,
    "autoExpandProjectItemsDropdown"
  ),
  autoExpandProjectItemsListEl: mustGetElement<HTMLElement>(doc, "autoExpandProjectItemsList"),
  autoTempChatEl: mustGetElement<HTMLInputElement>(doc, "autoTempChat"),
  oneClickDeleteEl: mustGetElement<HTMLInputElement>(doc, "oneClickDelete"),
  startDictationEl: mustGetElement<HTMLInputElement>(doc, "startDictation"),
  ctrlEnterSendsEl: mustGetElement<HTMLInputElement>(doc, "ctrlEnterSends"),
  trimChatDomEl: mustGetElement<HTMLInputElement>(doc, "trimChatDom"),
  trimChatDomKeepEl: mustGetElement<HTMLInputElement>(doc, "trimChatDomKeep"),
  trimChatDomKeepValueEl: mustGetElement<HTMLElement>(doc, "trimChatDomKeepValue"),
  trimChatDomDetailsEl: mustGetElement<HTMLElement>(doc, "trimChatDomDetails"),
  trimChatDomDetailsButtonEl: mustGetElement<HTMLButtonElement>(doc, "trimChatDomDetailsButton"),
  hideShareButtonEl: mustGetElement<HTMLInputElement>(doc, "hideShareButton"),
  wideChatWidthEl: mustGetElement<HTMLInputElement>(doc, "wideChatWidth"),
  wideChatDetailsEl: mustGetElement<HTMLElement>(doc, "wideChatDetails"),
  wideChatDetailsButtonEl: mustGetElement<HTMLButtonElement>(doc, "wideChatDetailsButton"),
  themeToggleEl: mustGetElement<HTMLButtonElement>(doc, "qqrm-theme-toggle"),
  macroRecorderEnabledEl: mustGetElement<HTMLInputElement>(doc, "macroRecorderEnabled"),
  macroRecorderStatusEl: mustGetElement<HTMLElement>(doc, "macroRecorderStatus"),
  macroRecorderMetaEl: mustGetElement<HTMLElement>(doc, "macroRecorderMeta"),
  macroRecorderControlEl: mustGetElement<HTMLElement>(doc, "macroRecorderControl"),
  debugAutoExpandProjectsEl: mustGetElement<HTMLInputElement>(doc, "debugAutoExpandProjects"),
  debugTraceTargetEl: mustGetElement<HTMLSelectElement>(doc, "debugTraceTarget"),
  debugTracesControlEl: mustGetElement<HTMLElement>(doc, "debugTracesControl"),
  devPanelEnabledEl: mustGetElement<HTMLInputElement>(doc, "devPanelEnabled"),
  panelContainerEl: mustGetElement<HTMLElement>(doc, "panelContainer"),
  tabBarEl: doc.querySelector<HTMLElement>(".tabBar"),
  tabButtonEls: {
    automation: mustGetElement<HTMLButtonElement>(doc, "tab-automation"),
    input: mustGetElement<HTMLButtonElement>(doc, "tab-input"),
    sidebar: mustGetElement<HTMLButtonElement>(doc, "tab-sidebar"),
    performance: mustGetElement<HTMLButtonElement>(doc, "tab-performance"),
    codex: mustGetElement<HTMLButtonElement>(doc, "tab-codex"),
    dev: mustGetElement<HTMLButtonElement>(doc, "tab-dev")
  },
  tabPanelEls: {
    automation: mustGetElement<HTMLElement>(doc, "panel-automation"),
    input: mustGetElement<HTMLElement>(doc, "panel-input"),
    sidebar: mustGetElement<HTMLElement>(doc, "panel-sidebar"),
    performance: mustGetElement<HTMLElement>(doc, "panel-performance"),
    codex: mustGetElement<HTMLElement>(doc, "panel-codex"),
    dev: mustGetElement<HTMLElement>(doc, "panel-dev")
  }
});

export async function initPopupController(deps: PopupControllerDeps): Promise<PopupController> {
  const doc = deps.document ?? document;
  const win = deps.window ?? window;
  const now = deps.now ?? (() => Date.now());
  const els = getPopupElements(doc);
  const popupDeps = { storagePort: deps.storagePort };
  const cleanupFns: Array<() => void> = [];
  const drawerTimerIds = new Map<DrawerId, number>();
  const drawerDeadlines: Record<DrawerId, number> = {
    trimChatDom: 0,
    wideChat: 0
  };
  const popupPreview =
    win.__CBE_POPUP_PREVIEW__ && typeof win.__CBE_POPUP_PREVIEW__ === "object"
      ? win.__CBE_POPUP_PREVIEW__
      : null;

  let themeMode: ThemeMode = "auto";
  let themeMediaQuery =
    typeof win.matchMedia === "function" ? win.matchMedia("(prefers-color-scheme: dark)") : null;
  let themeMediaListener: ((event: MediaQueryListEvent) => void) | null = null;
  let panelHeightMeasureRafId: number | null = null;
  let selectiveProjectsRegistry: AutoExpandProjectsRegistry = normalizeAutoExpandProjectsRegistry(
    {}
  );
  let selectiveProjectsPrefs: AutoExpandProjectsPrefs = normalizeAutoExpandProjectsPrefs({});
  let selectiveProjectsDropdownOpen = false;
  let selectiveProjectsDropdownTimerId: number | null = null;
  let disposed = false;

  const listen = <T extends EventTarget>(
    target: T,
    type: string,
    handler: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ) => {
    target.addEventListener(type, handler, options);
    cleanupFns.push(() => target.removeEventListener(type, handler, options));
  };

  const setThemeToggleState = (mode: ThemeMode) => {
    els.themeToggleEl.dataset.mode = mode;
  };

  const clearSelectiveProjectsDropdownTimer = () => {
    if (selectiveProjectsDropdownTimerId !== null) {
      win.clearTimeout(selectiveProjectsDropdownTimerId);
      selectiveProjectsDropdownTimerId = null;
    }
  };

  const setSelectiveProjectsDropdownOpen = (open: boolean) => {
    const nextOpen = !!els.autoExpandProjectItemsEl.checked && open;
    selectiveProjectsDropdownOpen = nextOpen;
    els.autoExpandProjectItemsRevealEl.dataset.open = nextOpen ? "true" : "false";
    els.autoExpandProjectItemsRevealEl.setAttribute("aria-expanded", nextOpen ? "true" : "false");
    els.autoExpandProjectItemsDropdownEl.hidden = !nextOpen;
    els.autoExpandProjectItemsDropdownEl.setAttribute("aria-hidden", nextOpen ? "false" : "true");

    if (nextOpen) {
      clearSelectiveProjectsDropdownTimer();
      selectiveProjectsDropdownTimerId = win.setTimeout(() => {
        selectiveProjectsDropdownTimerId = null;
        setSelectiveProjectsDropdownOpen(false);
      }, SELECTIVE_PROJECTS_DROPDOWN_AUTO_HIDE_MS);
    } else {
      clearSelectiveProjectsDropdownTimer();
    }

    schedulePanelHeightLock();
  };

  const resetSelectiveProjectsDropdownTimer = () => {
    if (!selectiveProjectsDropdownOpen) return;
    setSelectiveProjectsDropdownOpen(true);
  };

  const applyPreviewSettings = (settings: Settings): Settings => {
    if (!popupPreview?.settings) return settings;
    return normalizeSettings({ ...settings, ...popupPreview.settings });
  };

  const applyPreviewRegistry = (
    registry: AutoExpandProjectsRegistry
  ): AutoExpandProjectsRegistry =>
    popupPreview?.registry ? normalizeAutoExpandProjectsRegistry(popupPreview.registry) : registry;

  const applyPreviewPrefs = (prefs: AutoExpandProjectsPrefs): AutoExpandProjectsPrefs =>
    popupPreview?.prefs ? normalizeAutoExpandProjectsPrefs(popupPreview.prefs) : prefs;

  const renderSelectiveProjectsList = () => {
    els.autoExpandProjectItemsListEl.replaceChildren();

    const options = buildPopupSelectiveProjectOptions(
      selectiveProjectsRegistry,
      selectiveProjectsPrefs
    );
    if (!options.length) {
      const emptyEl = doc.createElement("div");
      emptyEl.className = "projectPrefsEmpty";
      emptyEl.textContent = "Projects appear here after ChatGPT renders them in the sidebar.";
      els.autoExpandProjectItemsListEl.appendChild(emptyEl);
      schedulePanelHeightLock();
      return;
    }

    for (const option of options) {
      const rowEl = doc.createElement("div");
      rowEl.className = "projectPrefsRow";

      const titleEl = doc.createElement("span");
      titleEl.className = "projectPrefsTitle";
      titleEl.textContent = option.title;
      titleEl.title = option.title;

      const switchLabelEl = doc.createElement("label");
      switchLabelEl.className = "tinySwitch";

      const inputEl = doc.createElement("input");
      inputEl.type = "checkbox";
      inputEl.checked = option.expanded;
      inputEl.dataset.projectHref = option.href;
      inputEl.setAttribute("aria-label", `Keep ${option.title} expanded`);
      inputEl.addEventListener("change", () => {
        selectiveProjectsPrefs = upsertPopupSelectiveProjectPref(
          selectiveProjectsPrefs,
          option.href,
          inputEl.checked
        );
        resetSelectiveProjectsDropdownTimer();
        void savePopupSelectiveProjectsPrefs(popupDeps, selectiveProjectsPrefs).catch(() => {});
      });

      const trackEl = doc.createElement("span");
      trackEl.className = "tinySwitchTrack";
      trackEl.setAttribute("aria-hidden", "true");

      switchLabelEl.append(inputEl, trackEl);
      rowEl.append(titleEl, switchLabelEl);
      els.autoExpandProjectItemsListEl.appendChild(rowEl);
    }

    schedulePanelHeightLock();
  };

  const syncSelectiveProjectsControls = () => {
    const enabled = !!els.autoExpandProjectItemsEl.checked;
    els.autoExpandProjectItemsRevealEl.hidden = !enabled;

    if (!enabled) {
      setSelectiveProjectsDropdownOpen(false);
      return;
    }

    renderSelectiveProjectsList();
    els.autoExpandProjectItemsRevealEl.dataset.open = selectiveProjectsDropdownOpen
      ? "true"
      : "false";
    els.autoExpandProjectItemsRevealEl.setAttribute(
      "aria-expanded",
      selectiveProjectsDropdownOpen ? "true" : "false"
    );
    els.autoExpandProjectItemsDropdownEl.hidden = !selectiveProjectsDropdownOpen;
    els.autoExpandProjectItemsDropdownEl.setAttribute(
      "aria-hidden",
      selectiveProjectsDropdownOpen ? "false" : "true"
    );
    schedulePanelHeightLock();
  };

  const clearDrawerTimer = (drawer: DrawerId) => {
    const timerId = drawerTimerIds.get(drawer);
    if (timerId !== undefined) {
      win.clearTimeout(timerId);
      drawerTimerIds.delete(drawer);
    }
  };

  const setDebugTraceTargetVisible = (visible: boolean) => {
    els.debugTraceTargetEl.style.display = visible ? "" : "none";
    schedulePanelHeightLock();
  };

  const renderMacroRecorderStatus = (status: unknown, _lastExportAt: unknown) => {
    const value: MacroRecorderRuntimeStatus =
      status === "armed" || status === "recording" || status === "ready" ? status : "off";

    els.macroRecorderStatusEl.textContent =
      value === "recording"
        ? "Recording"
        : value === "armed"
          ? "Armed"
          : value === "ready"
            ? "Ready"
            : "Off";
    els.macroRecorderMetaEl.textContent = "Ctrl/Cmd+Shift+F8 toggle";
  };

  const updateDeveloperControlsVisibility = () => {
    const isDeveloperMode = !!els.devPanelEnabledEl.checked;
    els.macroRecorderControlEl.style.display = isDeveloperMode ? "" : "none";
    els.debugTracesControlEl.style.display = isDeveloperMode ? "" : "none";
    setDebugTraceTargetVisible(isDeveloperMode && !!els.debugAutoExpandProjectsEl.checked);
  };

  const forceDisableHiddenDevFeatures = async () => {
    els.macroRecorderEnabledEl.checked = false;
    els.debugAutoExpandProjectsEl.checked = false;
    renderMacroRecorderStatus("off", undefined);
    setDebugTraceTargetVisible(false);
    await deps.storagePort.set({ macroRecorderEnabled: false, debugAutoExpandProjects: false });
  };

  const setActiveTab = async (tab: PopupTab, persist = true) => {
    for (const popupTab of popupTabs) {
      const isActive = popupTab === tab;
      const button = els.tabButtonEls[popupTab];
      const panel = els.tabPanelEls[popupTab];

      button.setAttribute("aria-selected", isActive ? "true" : "false");
      button.tabIndex = isActive ? 0 : -1;
      panel.classList.toggle("isActive", isActive);
      panel.style.display = isActive ? "" : "none";
      panel.setAttribute("aria-hidden", isActive ? "false" : "true");
    }

    if (persist) {
      await deps.storagePort.set({ popupActiveTab: tab });
    }
    schedulePanelHeightLock();
  };

  const measureMaxPanelHeightAndLock = () => {
    const panelContainerWidth = els.panelContainerEl.clientWidth;
    let maxHeight = 0;

    for (const panel of Object.values(els.tabPanelEls)) {
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

    els.panelContainerEl.style.height = `${maxHeight}px`;
    els.panelContainerEl.style.overflowY = "auto";
  };

  const schedulePanelHeightLock = () => {
    if (panelHeightMeasureRafId !== null) {
      win.cancelAnimationFrame(panelHeightMeasureRafId);
    }
    panelHeightMeasureRafId = win.requestAnimationFrame(() => {
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
      doc.documentElement.removeAttribute("data-theme");
      attachThemeMediaListener();
    } else {
      doc.documentElement.dataset.theme = mode;
      detachThemeMediaListener();
    }
    setThemeToggleState(mode);
    schedulePanelHeightLock();
  };

  const cycleThemeMode = async () => {
    const nextMode = themeMode === "auto" ? "dark" : themeMode === "dark" ? "light" : "auto";
    await deps.storagePort.set({ popupThemeMode: nextMode });
    applyThemeMode(nextMode);
  };

  const isDrawerAvailable = (drawer: DrawerId) =>
    drawer === "trimChatDom" ? !!els.trimChatDomEl.checked : true;

  const getDrawerButtonEl = (drawer: DrawerId) =>
    drawer === "trimChatDom" ? els.trimChatDomDetailsButtonEl : els.wideChatDetailsButtonEl;

  const getDrawerPanelEl = (drawer: DrawerId) =>
    drawer === "trimChatDom" ? els.trimChatDomDetailsEl : els.wideChatDetailsEl;

  const setDrawerButtonState = (drawer: DrawerId, open: boolean) => {
    const button = getDrawerButtonEl(drawer);
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.dataset.state = open ? "open" : "closed";
    if (drawer === "trimChatDom") {
      button.hidden = !els.trimChatDomEl.checked;
      button.setAttribute(
        "aria-label",
        open ? "Hide Trim chat DOM details" : "Show Trim chat DOM details"
      );
    } else {
      button.setAttribute(
        "aria-label",
        open ? "Hide chat width controls" : "Show chat width controls"
      );
    }
  };

  const setDrawerOpen = (drawer: DrawerId, open: boolean) => {
    const available = isDrawerAvailable(drawer);
    const shouldOpen = available && open;
    const panel = getDrawerPanelEl(drawer);
    panel.hidden = !shouldOpen;
    panel.setAttribute("aria-hidden", shouldOpen ? "false" : "true");
    setDrawerButtonState(drawer, shouldOpen);
    schedulePanelHeightLock();
  };

  const scheduleDrawerAutoClose = (drawer: DrawerId) => {
    clearDrawerTimer(drawer);
    const deadline = drawerDeadlines[drawer];
    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      setDrawerOpen(drawer, false);
      return;
    }

    const timerId = win.setTimeout(() => {
      void clearDrawerDeadline(drawer).catch(() => {});
    }, remainingMs);
    drawerTimerIds.set(drawer, timerId);
  };

  const persistDrawerDeadline = async (drawer: DrawerId, deadline: number) => {
    await deps.storagePort.set({ [drawerStorageKey(drawer)]: deadline });
  };

  const refreshDrawerDeadline = async (drawer: DrawerId) => {
    if (!isDrawerAvailable(drawer)) {
      await clearDrawerDeadline(drawer);
      return;
    }

    const deadline = now() + DRAWER_AUTO_CLOSE_MS;
    drawerDeadlines[drawer] = deadline;
    setDrawerOpen(drawer, true);
    scheduleDrawerAutoClose(drawer);
    await persistDrawerDeadline(drawer, deadline);
  };

  const clearDrawerDeadline = async (drawer: DrawerId) => {
    drawerDeadlines[drawer] = 0;
    clearDrawerTimer(drawer);
    setDrawerOpen(drawer, false);
    await persistDrawerDeadline(drawer, 0);
  };

  const syncTrimDrawerAvailability = () => {
    if (!els.trimChatDomEl.checked) {
      setDrawerOpen("trimChatDom", false);
      els.trimChatDomDetailsButtonEl.hidden = true;
      return;
    }
    setDrawerButtonState("trimChatDom", !els.trimChatDomDetailsEl.hidden);
  };

  const save = async () => {
    const wideChatWidth = Math.min(100, Math.max(0, Number(els.wideChatWidthEl.value) || 0));
    const trimChatDomKeep = Math.min(50, Math.max(5, Number(els.trimChatDomKeepEl.value) || 0));

    const debugTraceTarget: "projects" | "editMessage" | "autoSend" | "timestamps" =
      els.debugTraceTargetEl.value === "editMessage"
        ? "editMessage"
        : els.debugTraceTargetEl.value === "autoSend"
          ? "autoSend"
          : els.debugTraceTargetEl.value === "timestamps"
            ? "timestamps"
            : "projects";

    await savePopupSettings(popupDeps, {
      autoSend: !!els.autoSendEl.checked,
      allowAutoSendInCodex: !!els.allowCodexEl.checked,
      showMessageTimestamps: !!els.showMessageTimestampsEl.checked,
      preserveReadingPositionOnSend: !!els.preserveReadingPositionOnSendEl.checked,
      downloadGitPatchesWithShiftClick: !!els.downloadGitPatchesWithShiftClickEl.checked,
      clearClipboardAfterShiftDownload: true,
      editLastMessageOnArrowUp: !!els.editLastMessageEl.checked,
      renameChatOnF2: !!els.renameChatOnF2El.checked,
      autoExpandChats: !!els.autoExpandEl.checked,
      autoExpandProjects: !!els.autoExpandProjectsEl.checked,
      autoExpandProjectItems: !!els.autoExpandProjectItemsEl.checked,
      autoTempChat: !!els.autoTempChatEl.checked,
      oneClickDelete: !!els.oneClickDeleteEl.checked,
      startDictation: !!els.startDictationEl.checked,
      ctrlEnterSends: !!els.ctrlEnterSendsEl.checked,
      trimChatDom: !!els.trimChatDomEl.checked,
      trimChatDomKeep,
      hideShareButton: !!els.hideShareButtonEl.checked,
      wideChatWidth,
      macroRecorderEnabled: !!els.devPanelEnabledEl.checked && !!els.macroRecorderEnabledEl.checked,
      debugAutoExpandProjects:
        !!els.devPanelEnabledEl.checked && !!els.debugAutoExpandProjectsEl.checked,
      debugTraceTarget
    });

    els.trimChatDomKeepValueEl.textContent = String(trimChatDomKeep);
  };

  const load = async () => {
    const [
      { settings: loadedSettings },
      selectiveProjectsState,
      themeData,
      macroData,
      devData,
      tabData,
      drawerData
    ] = await Promise.all([
      loadPopupSettings(popupDeps),
      loadPopupSelectiveProjects(popupDeps),
      deps.storagePort.get({ popupThemeMode: "auto" as ThemeMode }),
      deps.storagePort.get({ macroRecorderStatus: "off", macroRecorderLastExportAt: 0 }),
      deps.storagePort.get({ popupDevPanelEnabled: false }),
      deps.storagePort.get({ popupActiveTab: "automation" as PopupTab }),
      deps.storagePort.get({
        popupTrimChatDomDetailsOpenUntil: 0,
        popupWideChatDetailsOpenUntil: 0
      })
    ]);
    const settings = applyPreviewSettings(loadedSettings);
    selectiveProjectsRegistry = applyPreviewRegistry(selectiveProjectsState.registry);
    selectiveProjectsPrefs = applyPreviewPrefs(selectiveProjectsState.prefs);
    selectiveProjectsDropdownOpen =
      !!settings.autoExpandProjectItems && !!popupPreview?.forceAutoExpandProjectsDropdownOpen;

    els.autoSendEl.checked = settings.autoSend;
    els.allowCodexEl.checked = settings.allowAutoSendInCodex;
    els.showMessageTimestampsEl.checked = settings.showMessageTimestamps;
    els.preserveReadingPositionOnSendEl.checked = settings.preserveReadingPositionOnSend;
    els.downloadGitPatchesWithShiftClickEl.checked = settings.downloadGitPatchesWithShiftClick;
    els.editLastMessageEl.checked = settings.editLastMessageOnArrowUp;
    els.renameChatOnF2El.checked = settings.renameChatOnF2;
    els.autoExpandEl.checked = settings.autoExpandChats;
    els.autoExpandProjectsEl.checked = settings.autoExpandProjects;
    els.autoExpandProjectItemsEl.checked = settings.autoExpandProjectItems;
    els.autoTempChatEl.checked = settings.autoTempChat;
    els.oneClickDeleteEl.checked = settings.oneClickDelete;
    els.startDictationEl.checked = settings.startDictation;
    els.ctrlEnterSendsEl.checked = settings.ctrlEnterSends;
    els.trimChatDomEl.checked = settings.trimChatDom;
    els.trimChatDomKeepEl.value = String(settings.trimChatDomKeep);
    els.trimChatDomKeepValueEl.textContent = String(settings.trimChatDomKeep);
    els.hideShareButtonEl.checked = settings.hideShareButton;
    els.wideChatWidthEl.value = String(settings.wideChatWidth);
    els.macroRecorderEnabledEl.checked = !!settings.macroRecorderEnabled;
    els.debugAutoExpandProjectsEl.checked = !!settings.debugAutoExpandProjects;
    els.debugTraceTargetEl.value = settings.debugTraceTarget;
    els.devPanelEnabledEl.checked = !!devData.popupDevPanelEnabled;

    if (!els.devPanelEnabledEl.checked) {
      await forceDisableHiddenDevFeatures();
    }

    syncSelectiveProjectsControls();
    const nowValue = now();
    drawerDeadlines.trimChatDom = settings.trimChatDom
      ? normalizeDrawerDeadline(drawerData.popupTrimChatDomDetailsOpenUntil, nowValue)
      : 0;
    drawerDeadlines.wideChat = normalizeDrawerDeadline(
      drawerData.popupWideChatDetailsOpenUntil,
      nowValue
    );

    syncTrimDrawerAvailability();
    setDrawerOpen("trimChatDom", drawerDeadlines.trimChatDom > nowValue);
    setDrawerOpen("wideChat", drawerDeadlines.wideChat > nowValue);
    scheduleDrawerAutoClose("trimChatDom");
    scheduleDrawerAutoClose("wideChat");

    const staleDrawerValues: Record<string, unknown> = {};
    if (
      drawerData.popupTrimChatDomDetailsOpenUntil !== drawerDeadlines.trimChatDom ||
      (!settings.trimChatDom && drawerData.popupTrimChatDomDetailsOpenUntil)
    ) {
      staleDrawerValues.popupTrimChatDomDetailsOpenUntil = drawerDeadlines.trimChatDom;
    }
    if (drawerData.popupWideChatDetailsOpenUntil !== drawerDeadlines.wideChat) {
      staleDrawerValues.popupWideChatDetailsOpenUntil = drawerDeadlines.wideChat;
    }
    if (Object.keys(staleDrawerValues).length > 0) {
      await deps.storagePort.set(staleDrawerValues);
    }

    updateDeveloperControlsVisibility();
    renderMacroRecorderStatus(macroData.macroRecorderStatus, macroData.macroRecorderLastExportAt);
    applyThemeMode(normalizeThemeMode(popupPreview?.popupThemeMode ?? themeData.popupThemeMode));
    await setActiveTab(
      normalizePopupTab(popupPreview?.popupActiveTab ?? tabData.popupActiveTab),
      false
    );
    schedulePanelHeightLock();
  };

  for (const tab of popupTabs) {
    listen(els.tabButtonEls[tab], "click", () => {
      void setActiveTab(tab)
        .then(schedulePanelHeightLock)
        .catch(() => {});
    });
  }

  if (els.tabBarEl) {
    listen(els.tabBarEl, "wheel", (event) => {
      const wheelEvent = event as WheelEvent;
      if (Math.abs(wheelEvent.deltaY) <= Math.abs(wheelEvent.deltaX)) {
        return;
      }
      els.tabBarEl!.scrollLeft += wheelEvent.deltaY;
      wheelEvent.preventDefault();
    });
  }

  listen(els.autoSendEl, "change", () => void save().catch(() => {}));
  listen(els.allowCodexEl, "change", () => void save().catch(() => {}));
  listen(els.showMessageTimestampsEl, "change", () => void save().catch(() => {}));
  listen(els.preserveReadingPositionOnSendEl, "change", () => void save().catch(() => {}));
  listen(els.downloadGitPatchesWithShiftClickEl, "change", () => void save().catch(() => {}));
  listen(els.editLastMessageEl, "change", () => void save().catch(() => {}));
  listen(els.renameChatOnF2El, "change", () => void save().catch(() => {}));
  listen(els.autoExpandEl, "change", () => void save().catch(() => {}));
  listen(els.autoExpandProjectsEl, "change", () => void save().catch(() => {}));
  listen(els.autoExpandProjectItemsEl, "change", () => {
    if (!els.autoExpandProjectItemsEl.checked) {
      setSelectiveProjectsDropdownOpen(false);
    }
    syncSelectiveProjectsControls();
    void save().catch(() => {});
  });
  listen(els.autoExpandProjectItemsRevealEl, "click", () => {
    if (!els.autoExpandProjectItemsEl.checked) return;
    setSelectiveProjectsDropdownOpen(!selectiveProjectsDropdownOpen);
  });
  listen(els.autoTempChatEl, "change", () => void save().catch(() => {}));
  listen(els.oneClickDeleteEl, "change", () => void save().catch(() => {}));
  listen(els.startDictationEl, "change", () => void save().catch(() => {}));
  listen(els.ctrlEnterSendsEl, "change", () => void save().catch(() => {}));
  listen(els.trimChatDomEl, "change", () => {
    syncTrimDrawerAvailability();
    const task = async () => {
      if (els.trimChatDomEl.checked) {
        await refreshDrawerDeadline("trimChatDom");
      } else {
        await clearDrawerDeadline("trimChatDom");
      }
      await save();
    };
    void task().catch(() => {});
  });
  listen(els.trimChatDomDetailsButtonEl, "click", () => {
    const task = async () => {
      if (els.trimChatDomDetailsEl.hidden) {
        await refreshDrawerDeadline("trimChatDom");
      } else {
        await clearDrawerDeadline("trimChatDom");
      }
    };
    void task().catch(() => {});
  });
  listen(els.trimChatDomKeepEl, "input", () => {
    els.trimChatDomKeepValueEl.textContent = String(
      Math.min(50, Math.max(5, Number(els.trimChatDomKeepEl.value) || 0))
    );
    const task = async () => {
      await refreshDrawerDeadline("trimChatDom");
      await save();
    };
    void task().catch(() => {});
  });
  listen(els.hideShareButtonEl, "change", () => void save().catch(() => {}));
  listen(els.wideChatDetailsButtonEl, "click", () => {
    const task = async () => {
      if (els.wideChatDetailsEl.hidden) {
        await refreshDrawerDeadline("wideChat");
      } else {
        await clearDrawerDeadline("wideChat");
      }
    };
    void task().catch(() => {});
  });
  listen(els.wideChatWidthEl, "input", () => {
    const task = async () => {
      await refreshDrawerDeadline("wideChat");
      await save();
    };
    void task().catch(() => {});
  });
  listen(els.themeToggleEl, "click", () => void cycleThemeMode().catch(() => {}));
  listen(els.macroRecorderEnabledEl, "change", () => void save().catch(() => {}));
  listen(els.debugAutoExpandProjectsEl, "change", () => {
    updateDeveloperControlsVisibility();
    schedulePanelHeightLock();
    void save().catch(() => {});
  });
  listen(els.debugTraceTargetEl, "change", () => {
    schedulePanelHeightLock();
    void save().catch(() => {});
  });
  listen(els.devPanelEnabledEl, "change", () => {
    const isDeveloperMode = !!els.devPanelEnabledEl.checked;
    updateDeveloperControlsVisibility();
    schedulePanelHeightLock();
    void deps.storagePort.set({ popupDevPanelEnabled: isDeveloperMode }).catch(() => {});
    if (!isDeveloperMode) {
      void forceDisableHiddenDevFeatures().catch(() => {});
    }
    void save().catch(() => {});
  });
  listen(win, "resize", schedulePanelHeightLock);
  for (const eventName of SELECTIVE_PROJECTS_ACTIVITY_EVENTS) {
    listen(els.autoExpandProjectItemsDropdownEl, eventName, () => {
      if (!selectiveProjectsDropdownOpen) return;
      resetSelectiveProjectsDropdownTimer();
    });
  }

  deps.storagePort.onChanged?.((changes) => {
    if (disposed) return;

    if ("autoExpandProjectItems" in changes) {
      const next = changes.autoExpandProjectItems?.newValue;
      if (typeof next === "boolean") {
        els.autoExpandProjectItemsEl.checked = next;
        if (!next) {
          setSelectiveProjectsDropdownOpen(false);
        }
        syncSelectiveProjectsControls();
      }
    }

    if (AUTO_EXPAND_PROJECTS_REGISTRY_KEY in changes) {
      selectiveProjectsRegistry = normalizeAutoExpandProjectsRegistry(
        changes[AUTO_EXPAND_PROJECTS_REGISTRY_KEY]?.newValue
      );
      syncSelectiveProjectsControls();
    }

    if (AUTO_EXPAND_PROJECTS_PREFS_KEY in changes) {
      selectiveProjectsPrefs = normalizeAutoExpandProjectsPrefs(
        changes[AUTO_EXPAND_PROJECTS_PREFS_KEY]?.newValue
      );
      syncSelectiveProjectsControls();
    }

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
        if (!els.devPanelEnabledEl.checked && next) {
          void forceDisableHiddenDevFeatures().catch(() => {});
          return;
        }
        els.macroRecorderEnabledEl.checked = next;
        if (!next) {
          renderMacroRecorderStatus("off", undefined);
        }
      }
    }

    if ("debugAutoExpandProjects" in changes) {
      const next = changes.debugAutoExpandProjects?.newValue;
      if (typeof next === "boolean") {
        if (!els.devPanelEnabledEl.checked && next) {
          void forceDisableHiddenDevFeatures().catch(() => {});
          return;
        }
        els.debugAutoExpandProjectsEl.checked = next;
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
        els.debugTraceTargetEl.value = next;
      }
    }

    if ("popupDevPanelEnabled" in changes) {
      const next = changes.popupDevPanelEnabled?.newValue;
      if (typeof next === "boolean") {
        els.devPanelEnabledEl.checked = next;
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

    if ("popupTrimChatDomDetailsOpenUntil" in changes) {
      drawerDeadlines.trimChatDom = els.trimChatDomEl.checked
        ? normalizeDrawerDeadline(changes.popupTrimChatDomDetailsOpenUntil?.newValue, now())
        : 0;
      setDrawerOpen("trimChatDom", drawerDeadlines.trimChatDom > now());
      scheduleDrawerAutoClose("trimChatDom");
    }

    if ("popupWideChatDetailsOpenUntil" in changes) {
      drawerDeadlines.wideChat = normalizeDrawerDeadline(
        changes.popupWideChatDetailsOpenUntil?.newValue,
        now()
      );
      setDrawerOpen("wideChat", drawerDeadlines.wideChat > now());
      scheduleDrawerAutoClose("wideChat");
    }
  });

  await load();

  return {
    dispose() {
      disposed = true;
      clearDrawerTimer("trimChatDom");
      clearDrawerTimer("wideChat");
      clearSelectiveProjectsDropdownTimer();
      if (panelHeightMeasureRafId !== null) {
        win.cancelAnimationFrame(panelHeightMeasureRafId);
        panelHeightMeasureRafId = null;
      }
      detachThemeMediaListener();
      cleanupFns.splice(0).forEach((cleanup) => cleanup());
    }
  };
}
