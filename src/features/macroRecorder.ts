import type { eventWithTime } from "@rrweb/types";
import {
  defaultMacroRecorderDeps,
  type MacroRecorderDeps,
  type RrwebStartOptions
} from "./macroRecorder.deps";
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

function escapeCss(value: string) {
  const cssEscape = globalThis.CSS?.escape;
  if (typeof cssEscape === "function") return cssEscape(value);

  // Best-effort fallback aligned with the CSS.escape polyfill behavior.
  const string = String(value);
  const length = string.length;
  let index = -1;
  let codeUnit: number;
  let result = "";
  const firstCodeUnit = string.charCodeAt(0);

  while (++index < length) {
    codeUnit = string.charCodeAt(index);

    if (codeUnit === 0x0000) {
      result += "\uFFFD";
      continue;
    }

    if (
      (codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
      codeUnit === 0x007f ||
      (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (index === 1 && codeUnit >= 0x0030 && codeUnit <= 0x0039 && firstCodeUnit === 0x002d)
    ) {
      result += `\\${codeUnit.toString(16)} `;
      continue;
    }

    if (index === 0 && codeUnit === 0x002d && length === 1) {
      result += "\\-";
      continue;
    }

    if (
      codeUnit >= 0x0080 ||
      codeUnit === 0x002d ||
      codeUnit === 0x005f ||
      (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
      (codeUnit >= 0x0061 && codeUnit <= 0x007a)
    ) {
      result += string.charAt(index);
      continue;
    }

    result += `\\${string.charAt(index)}`;
  }

  return result;
}

function buildStableSelector(el: Element | null): string | null {
  if (!el) return null;

  const testId = el.getAttribute("data-testid");
  if (testId) return `[data-testid="${escapeCss(testId)}"]`;

  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return `${el.tagName.toLowerCase()}[aria-label="${escapeCss(ariaLabel)}"]`;

  const html = el as HTMLElement;
  if (html.id) return `#${escapeCss(html.id)}`;

  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute("role");
  const parent = el.parentElement;
  if (!parent) return role ? `${tag}[role="${escapeCss(role)}"]` : tag;

  const matchingSiblings = Array.from(parent.children).filter(
    (child) => child.tagName === el.tagName
  );
  const nth = matchingSiblings.indexOf(el) + 1;
  if (nth <= 0) return role ? `${tag}[role="${escapeCss(role)}"]` : tag;

  return role
    ? `${tag}[role="${escapeCss(role)}"]:nth-of-type(${nth})`
    : `${tag}:nth-of-type(${nth})`;
}

export function initMacroRecorderFeature(
  ctx: FeatureContext,
  deps: MacroRecorderDeps = defaultMacroRecorderDeps
): FeatureHandle {
  let status: RecorderStatus = ctx.settings.macroRecorderEnabled ? "armed" : "off";
  let activeRecording = false;
  let rrwebEvents: eventWithTime[] = [];
  let actions: MacroAction[] = [];
  let startedAt: number | null = null;
  let stoppedAt: number | null = null;
  let stopRrweb: (() => void) | null = null;
  let lastPayload: ExportPayload | null = null;

  const persistStatus = (next: RecorderStatus) => {
    status = next;
    const updatedAt = deps.now();
    void ctx.storagePort.set({
      [STATUS_KEY]: next,
      [STATUS_UPDATED_AT_KEY]: updatedAt
    });
  };

  const persistLastExportAt = () => {
    const timestamp = deps.now();
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
    createdAt: deps.isoNow(),
    pageUrl: deps.pageUrl(),
    userAgent: deps.userAgent(),
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
    deps.addRrwebCustomEvent("macro_step", action);
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
      t: deps.now(),
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
      t: deps.now(),
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
      t: deps.now(),
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
    stoppedAt = deps.now();
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

    const stamp = deps.isoNow().replace(/[:.]/g, "-");
    deps.downloadJson(`qqrm-macro-recording-${stamp}.json`, lastPayload);
    persistLastExportAt();
    return true;
  };

  const startRecording = () => {
    if (!ctx.settings.macroRecorderEnabled || activeRecording) return;

    resetSession();
    activeRecording = true;
    startedAt = deps.now();
    attachSemanticListeners();

    const rrwebOptions: RrwebStartOptions = {
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
    };

    stopRrweb = deps.startRrweb(rrwebOptions);

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
        deps.showToast("Macro recording saved");
      }
      return;
    }

    startRecording();
    deps.showToast("Macro recording started", "active");
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
