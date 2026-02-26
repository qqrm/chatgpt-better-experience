import type { eventWithTime } from "@rrweb/types";
import {
  clearRecorderToast,
  defaultMacroRecorderDeps,
  type MacroRecorderDeps,
  type RrwebStartOptions
} from "./macroRecorder.deps";
import type { FeatureContext, FeatureHandle } from "../application/featureContext";
import { routeKeyCombos, type KeyCombo } from "./keyCombos";
import type {
  LifecycleEventName,
  MacroAction,
  MacroLifecycleEntry,
  RecorderStatus
} from "./macroRecorder.persistence";

const STATUS_KEY = "macroRecorderStatus";
const STATUS_UPDATED_AT_KEY = "macroRecorderStatusUpdatedAt";
const LAST_EXPORT_KEY = "macroRecorderLastExportAt";
const FLUSH_INTERVAL_MS = 900;
const FLUSH_EVENT_THRESHOLD = 25;

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

function getElementMeta(el: Element | null) {
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

function getNavigationType() {
  const nav = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  return nav?.type ?? null;
}

export function initMacroRecorderFeature(
  ctx: FeatureContext,
  deps: MacroRecorderDeps = defaultMacroRecorderDeps
): FeatureHandle {
  let status: RecorderStatus = ctx.settings.macroRecorderEnabled ? "armed" : "off";
  let activeRecording = false;
  let segmentIndex = 0;
  let currentSessionId: string | null = null;
  let currentSegmentId: string | null = null;
  let stopRrweb: (() => void) | null = null;
  let recorderListenersAttached = false;
  let lifecycleListenersAttached = false;
  let flushTimer: number | null = null;
  let flushInFlight: Promise<void> = Promise.resolve();
  let toggling = false;
  let currentSegmentFinalized = false;

  let rrwebBuffer: eventWithTime[] = [];
  let actionsBuffer: MacroAction[] = [];
  let lifecycleBuffer: MacroLifecycleEntry[] = [];

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

  const enqueueFlush = () => {
    const pendingCount = rrwebBuffer.length + actionsBuffer.length + lifecycleBuffer.length;
    if (!currentSessionId || !currentSegmentId || pendingCount <= 0) return;
    const sessionId = currentSessionId;
    const segmentId = currentSegmentId;

    const rrwebEvents = rrwebBuffer;
    const actions = actionsBuffer;
    const lifecycleTrace = lifecycleBuffer;
    rrwebBuffer = [];
    actionsBuffer = [];
    lifecycleBuffer = [];

    flushInFlight = flushInFlight
      .then(async () => {
        await deps.persistence.appendToSegment({
          sessionId,
          segmentId,
          rrwebEvents,
          actions,
          lifecycleTrace
        });
      })
      .catch(() => {
        deps.showToast("Macro recording persistence failed", "neutral");
      });
  };

  const scheduleFlush = (force = false) => {
    if (!activeRecording) return;
    const pendingCount = rrwebBuffer.length + actionsBuffer.length + lifecycleBuffer.length;
    if (pendingCount <= 0) return;
    if (force || pendingCount >= FLUSH_EVENT_THRESHOLD) {
      enqueueFlush();
      return;
    }
    if (flushTimer) return;
    flushTimer = window.setTimeout(() => {
      flushTimer = null;
      enqueueFlush();
    }, FLUSH_INTERVAL_MS);
  };

  const cancelFlushTimer = () => {
    if (!flushTimer) return;
    window.clearTimeout(flushTimer);
    flushTimer = null;
  };

  const addLifecycleEntry = (
    event: LifecycleEventName,
    persisted?: boolean,
    options?: { allowWhenInactive?: boolean; forceFlush?: boolean }
  ) => {
    if (!activeRecording && !options?.allowWhenInactive) return;
    lifecycleBuffer.push({
      t: deps.now(),
      isoTime: deps.isoNow(),
      event,
      url: deps.pageUrl(),
      navType: getNavigationType(),
      visibilityState: document.visibilityState,
      readyState: document.readyState,
      referrer: document.referrer,
      ...(typeof persisted === "boolean" ? { persisted } : {})
    });
    scheduleFlush(
      options?.forceFlush ||
        event === "beforeunload" ||
        event === "pagehide" ||
        event === "segment_finalize"
    );
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
    actionsBuffer.push(action);
    deps.addRrwebCustomEvent("macro_step", action);
    scheduleFlush();
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
    actionsBuffer.push(action);
    deps.addRrwebCustomEvent("macro_step", action);
    scheduleFlush();
  };

  const onKeydownForSemanticLog = (event: KeyboardEvent) => {
    if (!activeRecording) return;
    if (isMacroRecorderToggleHotkey(event)) return;

    actionsBuffer.push({
      t: deps.now(),
      kind: "keydown",
      key: event.key,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      metaKey: event.metaKey
    });
    scheduleFlush();
  };

  const attachSemanticListeners = () => {
    if (recorderListenersAttached) return;
    recorderListenersAttached = true;
    document.addEventListener("click", onClick, true);
    document.addEventListener("input", onInput, true);
    document.addEventListener("keydown", onKeydownForSemanticLog, true);
  };

  const detachSemanticListeners = () => {
    if (!recorderListenersAttached) return;
    recorderListenersAttached = false;
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("keydown", onKeydownForSemanticLog, true);
  };

  const onPageShow = (event: PageTransitionEvent) => addLifecycleEntry("pageshow", event.persisted);
  const onPageHide = (event: PageTransitionEvent) => addLifecycleEntry("pagehide", event.persisted);
  const onBeforeUnload = () => addLifecycleEntry("beforeunload");
  const onVisibilityChange = () => addLifecycleEntry("visibilitychange");
  const onLoad = () => addLifecycleEntry("load");

  const attachLifecycleListeners = () => {
    if (lifecycleListenersAttached) return;
    lifecycleListenersAttached = true;
    window.addEventListener("pageshow", onPageShow, true);
    window.addEventListener("pagehide", onPageHide, true);
    window.addEventListener("beforeunload", onBeforeUnload, true);
    window.addEventListener("load", onLoad, true);
    document.addEventListener("visibilitychange", onVisibilityChange, true);
  };

  const detachLifecycleListeners = () => {
    if (!lifecycleListenersAttached) return;
    lifecycleListenersAttached = false;
    window.removeEventListener("pageshow", onPageShow, true);
    window.removeEventListener("pagehide", onPageHide, true);
    window.removeEventListener("beforeunload", onBeforeUnload, true);
    window.removeEventListener("load", onLoad, true);
    document.removeEventListener("visibilitychange", onVisibilityChange, true);
  };

  const finalizeSegment = async () => {
    if (!currentSessionId || !currentSegmentId || currentSegmentFinalized) return;
    currentSegmentFinalized = true;

    addLifecycleEntry("segment_finalize", undefined, { allowWhenInactive: true, forceFlush: true });
    cancelFlushTimer();
    enqueueFlush();
    await flushInFlight;

    await deps.persistence.finalizeSegment({
      sessionId: currentSessionId,
      segmentId: currentSegmentId,
      endedAt: deps.now(),
      endedAtIso: deps.isoNow()
    });
  };

  const stopRecording = async () => {
    if (!activeRecording || !currentSessionId) return false;

    detachSemanticListeners();
    detachLifecycleListeners();

    try {
      stopRrweb?.();
    } catch {
      // best-effort stop
    }
    stopRrweb = null;

    await finalizeSegment();
    activeRecording = false;
    await deps.persistence.stopSession({
      sessionId: currentSessionId,
      stoppedAt: deps.now(),
      stoppedAtIso: deps.isoNow()
    });

    clearRecorderToast();
    persistStatus("ready");
    return true;
  };

  const exportLastRecording = async () => {
    if (!currentSessionId) return false;
    const payload = await deps.persistence.buildExport(currentSessionId);
    if (!payload) return false;

    const stamp = deps.isoNow().replace(/[:.]/g, "-");
    deps.downloadJson(`qqrm-macro-recording-${stamp}.json`, payload);
    persistLastExportAt();
    await deps.persistence.clearSession(currentSessionId);
    return true;
  };

  const startSegment = async () => {
    if (!currentSessionId) return;
    segmentIndex += 1;
    currentSegmentId = `${currentSessionId}-segment-${segmentIndex}`;
    currentSegmentFinalized = false;

    await deps.persistence.createSegment({
      sessionId: currentSessionId,
      segmentId: currentSegmentId,
      index: segmentIndex,
      startedAt: deps.now(),
      startedAtIso: deps.isoNow(),
      pageUrl: deps.pageUrl(),
      referrer: document.referrer,
      navigationType: getNavigationType()
    });

    addLifecycleEntry("segment_start");
  };

  const startRecording = async (resume = false) => {
    if (!ctx.settings.macroRecorderEnabled || activeRecording) return;

    if (!resume) {
      segmentIndex = 0;
      currentSessionId = `macro-${deps.now()}-${Math.random().toString(36).slice(2, 10)}`;
      await deps.persistence.createSession({
        sessionId: currentSessionId,
        createdAt: deps.now(),
        createdAtIso: deps.isoNow(),
        userAgent: deps.userAgent()
      });
    }

    rrwebBuffer = [];
    actionsBuffer = [];
    lifecycleBuffer = [];
    activeRecording = true;

    await startSegment();
    attachSemanticListeners();
    attachLifecycleListeners();

    const rrwebOptions: RrwebStartOptions = {
      emit: (event: eventWithTime) => {
        rrwebBuffer.push(event);
        scheduleFlush();
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
      blockClass: "qqrm-macro-recorder-ignore",
      maskTextSelector: "input,textarea,[contenteditable='true']",
      slimDOMOptions: "all"
    };

    stopRrweb = deps.startRrweb(rrwebOptions);
    persistStatus("recording");
  };

  const cleanupRecordingResources = async () => {
    if (!activeRecording) return;
    detachSemanticListeners();
    detachLifecycleListeners();
    cancelFlushTimer();
    try {
      stopRrweb?.();
    } catch {
      // best-effort stop
    }
    stopRrweb = null;

    try {
      await finalizeSegment();
    } catch {
      // best-effort finalize during teardown
    }

    activeRecording = false;
    clearRecorderToast();
  };

  const onToggleHotkey = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
    if (event.repeat || toggling) return;

    toggling = true;
    void (async () => {
      try {
        if (activeRecording) {
          const stopped = await stopRecording();
          if (stopped) {
            await exportLastRecording();
            deps.showToast("Macro recording saved");
          }
          return;
        }

        await startRecording(false);
        deps.showToast("Macro recording in progress", "recording");
        deps.showToast("Macro recording started", "active");
      } catch {
        deps.showToast("Macro recording failed", "neutral");
      } finally {
        toggling = false;
      }
    })();
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

  void (async () => {
    if (!ctx.settings.macroRecorderEnabled) return;
    const activeSession = await deps.persistence.loadActiveSession();
    if (!activeSession) return;
    currentSessionId = activeSession.sessionId;
    segmentIndex = activeSession.segments.length;
    await startRecording(true);
    deps.showToast("Macro recording in progress", "recording");
  })();

  window.addEventListener("keydown", onHotkey, true);

  return {
    name: "macroRecorder",
    dispose() {
      window.removeEventListener("keydown", onHotkey, true);
      void cleanupRecordingResources();
      clearRecorderToast();
    },
    onSettingsChange(next, prev) {
      if (next.macroRecorderEnabled === prev.macroRecorderEnabled) return;

      if (!next.macroRecorderEnabled) {
        void stopRecording();
        persistStatus("off");
        return;
      }

      if (activeRecording) persistStatus("recording");
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
