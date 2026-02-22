import { record } from "@rrweb/record";
import type { eventWithTime } from "@rrweb/types";
import type { FeatureContext, FeatureHandle } from "../application/featureContext";
import { routeKeyCombos, type KeyCombo } from "./keyCombos";

type RecorderStatus = "off" | "armed" | "recording" | "ready";

type ElementMeta = {
  tag: string;
  id?: string;
  role?: string;
  testId?: string;
  ariaLabel?: string;
  title?: string;
  text?: string;
};

type MacroAction =
  | {
      t: number;
      kind: "click";
      selector: string;
      meta: ElementMeta;
    }
  | {
      t: number;
      kind: "input";
      selector: string;
      valueLength: number;
      meta: ElementMeta;
    }
  | {
      t: number;
      kind: "keydown";
      key: string;
      ctrl: boolean;
      alt: boolean;
      shift: boolean;
      metaKey: boolean;
    };

type ExportPayload = {
  schemaVersion: 1;
  createdAt: string;
  pageUrl: string;
  userAgent: string;
  rrwebEvents: eventWithTime[];
  actions: MacroAction[];
  meta: {
    startedAt: number | null;
    stoppedAt: number | null;
    durationMs: number;
  };
};

const STATUS_KEY = "macroRecorderStatus";
const STATUS_UPDATED_AT_KEY = "macroRecorderStatusUpdatedAt";
const LAST_EXPORT_KEY = "macroRecorderLastExportAt";

const now = () => Date.now();

function isMacroRecorderToggleHotkey(event: KeyboardEvent) {
  return event.key === "F8" && event.shiftKey && (event.ctrlKey || event.metaKey);
}

function shortText(value: string | null | undefined, max = 80) {
  const normalized = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function getElementMeta(el: Element | null): ElementMeta {
  if (!el) return { tag: "unknown" };

  const html = el as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute("role") || undefined;
  const allowText = tag === "button" || tag === "a" || role === "button" || role === "menuitem";

  return {
    tag,
    id: html.id || undefined,
    role,
    testId: el.getAttribute("data-testid") || undefined,
    ariaLabel: el.getAttribute("aria-label") || undefined,
    title: el.getAttribute("title") || undefined,
    text: allowText ? shortText(html.innerText || el.textContent || "") : undefined
  };
}

function buildStableSelector(el: Element | null): string | null {
  if (!el) return null;

  const testId = el.getAttribute("data-testid");
  if (testId) return `[data-testid="${CSS.escape(testId)}"]`;

  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return `${el.tagName.toLowerCase()}[aria-label="${CSS.escape(ariaLabel)}"]`;

  const html = el as HTMLElement;
  if (html.id) return `#${CSS.escape(html.id)}`;

  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute("role");
  const parent = el.parentElement;
  if (!parent) return role ? `${tag}[role="${CSS.escape(role)}"]` : tag;

  const matchingSiblings = Array.from(parent.children).filter(
    (child) => child.tagName === el.tagName
  );
  const nth = matchingSiblings.indexOf(el) + 1;
  if (nth <= 0) return role ? `${tag}[role="${CSS.escape(role)}"]` : tag;

  return role
    ? `${tag}[role="${CSS.escape(role)}"]:nth-of-type(${nth})`
    : `${tag}:nth-of-type(${nth})`;
}

function triggerJsonDownload(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.className = "qqrm-macro-recorder-ignore";
  anchor.style.display = "none";
  (document.body || document.documentElement).appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

const TOAST_HOST_ID = "qqrm-macro-recorder-toast-host";
const TOAST_ID = "qqrm-macro-recorder-toast";

function ensureToastHost(retry = false) {
  const existing = document.getElementById(TOAST_HOST_ID);
  if (existing) return existing;

  const mount = document.body || document.documentElement;
  if (!mount) {
    if (!retry) {
      window.setTimeout(() => {
        ensureToastHost(true);
      }, 0);
    }
    return null;
  }

  const host = document.createElement("div");
  host.id = TOAST_HOST_ID;
  host.className = "qqrm-macro-recorder-ignore";
  host.style.position = "fixed";
  host.style.top = "16px";
  host.style.left = "50%";
  host.style.transform = "translateX(-50%)";
  host.style.zIndex = "2147483647";
  host.style.pointerEvents = "none";
  mount.appendChild(host);
  return host;
}

function showRecorderToast(message: string, tone: "active" | "neutral" = "neutral") {
  try {
    const host = ensureToastHost();
    if (!host) return;

    const existingToast = document.getElementById(TOAST_ID);
    const toast =
      existingToast instanceof HTMLDivElement ? existingToast : document.createElement("div");
    if (!existingToast) {
      toast.id = TOAST_ID;
      toast.className = "qqrm-macro-recorder-ignore";
      host.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.background =
      tone === "active" ? "rgba(22, 101, 52, 0.9)" : "rgba(17, 24, 39, 0.88)";
    toast.style.color = "#fff";
    toast.style.borderRadius = "8px";
    toast.style.padding = "8px 12px";
    toast.style.fontSize = "12px";
    toast.style.fontWeight = "500";
    toast.style.maxWidth = "320px";
    toast.style.boxShadow = "0 10px 25px rgba(0, 0, 0, 0.25)";
    toast.style.opacity = "1";
    toast.style.transition = "opacity 140ms ease-out";

    const timerKey = "qqrmMacroRecorderToastTimer";
    const priorTimer = Number(toast.dataset[timerKey] || 0);
    if (priorTimer) {
      window.clearTimeout(priorTimer);
    }
    const timerId = window.setTimeout(() => {
      toast.style.opacity = "0";
      window.setTimeout(() => {
        if (toast.parentElement) toast.remove();
      }, 160);
    }, 1500);
    toast.dataset[timerKey] = String(timerId);
  } catch {
    // visual feedback is best-effort only.
  }
}

export function initMacroRecorderFeature(ctx: FeatureContext): FeatureHandle {
  let status: RecorderStatus = ctx.settings.macroRecorderEnabled ? "armed" : "off";
  let activeRecording = false;
  let rrwebEvents: eventWithTime[] = [];
  let actions: MacroAction[] = [];
  let startedAt: number | null = null;
  let stoppedAt: number | null = null;
  let stopRrweb: ReturnType<typeof record> | null = null;
  let lastPayload: ExportPayload | null = null;

  const persistStatus = (next: RecorderStatus) => {
    status = next;
    const updatedAt = now();
    void ctx.storagePort.set({
      [STATUS_KEY]: next,
      [STATUS_UPDATED_AT_KEY]: updatedAt
    });
  };

  const persistLastExportAt = () => {
    const timestamp = now();
    void ctx.storagePort.set({ [LAST_EXPORT_KEY]: timestamp });
  };

  const resetSession = () => {
    rrwebEvents = [];
    actions = [];
    startedAt = null;
    stoppedAt = null;
  };

  const makeExportPayload = (): ExportPayload => ({
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    pageUrl: location.href,
    userAgent: navigator.userAgent,
    rrwebEvents,
    actions,
    meta: {
      startedAt,
      stoppedAt,
      durationMs:
        startedAt && stoppedAt && stoppedAt >= startedAt ? Math.max(0, stoppedAt - startedAt) : 0
    }
  });

  const addActionToRrwebCustomEvent = (action: MacroAction) => {
    try {
      (
        record as typeof record & { addCustomEvent?: (tag: string, payload: unknown) => void }
      ).addCustomEvent?.("macro_step", action);
    } catch {
      // rrweb custom event support varies by build; semantic log is still exported.
    }
  };

  const onClick = (event: MouseEvent) => {
    if (!activeRecording) return;

    const target = event.target instanceof Element ? event.target : null;
    const element =
      target?.closest(
        "button,a,[role='button'],[role='menuitem'],input,textarea,[contenteditable='true']"
      ) ?? target;

    const selector = buildStableSelector(element);
    if (!selector) return;

    const action: MacroAction = {
      t: now(),
      kind: "click",
      selector,
      meta: getElementMeta(element)
    };
    actions.push(action);
    addActionToRrwebCustomEvent(action);
  };

  const onInput = (event: Event) => {
    if (!activeRecording) return;

    const element = event.target instanceof HTMLElement ? event.target : null;
    if (!element) return;

    const selector = buildStableSelector(element);
    if (!selector) return;

    let valueLength = 0;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      valueLength = element.value.length;
    } else if (element.isContentEditable) {
      valueLength = (element.innerText || "").length;
    } else {
      return;
    }

    const action: MacroAction = {
      t: now(),
      kind: "input",
      selector,
      valueLength,
      meta: getElementMeta(element)
    };
    actions.push(action);
    addActionToRrwebCustomEvent(action);
  };

  const onKeydownForSemanticLog = (event: KeyboardEvent) => {
    if (!activeRecording) return;
    if (isMacroRecorderToggleHotkey(event)) return;

    actions.push({
      t: now(),
      kind: "keydown",
      key: event.key,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      metaKey: event.metaKey
    });
  };

  const attachSemanticListeners = () => {
    document.addEventListener("click", onClick, true);
    document.addEventListener("input", onInput, true);
    document.addEventListener("keydown", onKeydownForSemanticLog, true);
  };

  const detachSemanticListeners = () => {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("keydown", onKeydownForSemanticLog, true);
  };

  const stopRecording = () => {
    if (!activeRecording) return false;

    activeRecording = false;
    stoppedAt = now();
    detachSemanticListeners();

    try {
      stopRrweb?.();
    } catch {
      // best-effort stop
    }
    stopRrweb = null;

    lastPayload = makeExportPayload();
    persistStatus("ready");
    return true;
  };

  const exportLastRecording = () => {
    if (!lastPayload) return false;

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    triggerJsonDownload(`qqrm-macro-recording-${stamp}.json`, lastPayload);
    persistLastExportAt();
    return true;
  };

  const startRecording = () => {
    if (!ctx.settings.macroRecorderEnabled || activeRecording) return;

    resetSession();
    activeRecording = true;
    startedAt = now();
    attachSemanticListeners();

    // Static import is intentional for now; current bundling setup is single-bundle oriented.
    stopRrweb = record({
      emit: (event: eventWithTime) => {
        rrwebEvents.push(event);
      },
      sampling: {
        mousemove: false,
        scroll: 150
      },
      maskAllInputs: true,
      maskInputOptions: {
        text: true,
        textarea: true,
        select: true,
        password: true,
        email: true,
        search: true,
        tel: true,
        url: true
      },
      // Keep extension helper nodes and editable text masked from rrweb snapshots.
      blockClass: "qqrm-macro-recorder-ignore",
      maskTextSelector: "input,textarea,[contenteditable='true']",
      slimDOMOptions: "all"
    });

    persistStatus("recording");
  };

  const cleanupRecordingResources = () => {
    if (!activeRecording) return;
    activeRecording = false;
    detachSemanticListeners();
    try {
      stopRrweb?.();
    } catch {
      // best-effort stop
    }
    stopRrweb = null;
  };

  const onToggleHotkey = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
    if (event.repeat) return;

    if (activeRecording) {
      const stopped = stopRecording();
      if (stopped) {
        exportLastRecording();
        showRecorderToast("Macro recording saved");
      }
      return;
    }

    startRecording();
    showRecorderToast("Macro recording started", "active");
  };

  const combos: KeyCombo[] = [
    {
      key: "F8",
      shift: true,
      ctrl: true,
      priority: 1000,
      when: () => !!ctx.settings.macroRecorderEnabled,
      handler: onToggleHotkey
    },
    {
      key: "F8",
      shift: true,
      meta: true,
      priority: 1000,
      when: () => !!ctx.settings.macroRecorderEnabled,
      handler: onToggleHotkey
    }
  ];

  const onHotkey = (event: KeyboardEvent) => {
    routeKeyCombos(event, combos);
    if (event.defaultPrevented) {
      event.stopImmediatePropagation();
      event.stopPropagation();
    }
  };

  window.addEventListener("keydown", onHotkey, true);

  return {
    name: "macroRecorder",
    dispose() {
      window.removeEventListener("keydown", onHotkey, true);
      cleanupRecordingResources();
    },
    onSettingsChange(next, prev) {
      if (next.macroRecorderEnabled === prev.macroRecorderEnabled) return;

      if (!next.macroRecorderEnabled) {
        stopRecording();
        persistStatus("off");
        return;
      }

      if (activeRecording) persistStatus("recording");
      else if (lastPayload) persistStatus("ready");
      else persistStatus("armed");
    },
    getStatus() {
      return {
        active: ctx.settings.macroRecorderEnabled,
        details: status
      };
    }
  };
}
