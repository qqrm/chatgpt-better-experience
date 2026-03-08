import { DebugTraceTarget, Settings } from "../domain/settings";
import { StoragePort } from "../domain/ports/storagePort";
import { onPathChange as subscribePathChange } from "../lib/locationWatcher";
import type { DomEventBus } from "./domEventBus";

export interface KeyState {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

export interface LogFields extends Record<string, unknown> {
  preview?: string;
  snapshot?: string;
  btn?: string;
}

export type TraceLevel = "log" | "info" | "warn" | "error";

export interface TraceFields extends Record<string, unknown> {
  path?: string;
  mode?: string;
  dictationState?: string;
  composerKind?: string;
  sendButtonState?: string;
}

export interface Logger {
  isEnabled: boolean;
  debug: (scope: string, message: string, fields?: LogFields) => void;
  isTraceEnabled: (target: DebugTraceTarget) => boolean;
  trace: (
    target: DebugTraceTarget,
    scope: string,
    message: string,
    fields?: TraceFields,
    level?: TraceLevel
  ) => void;
  contractSnapshot: (target: DebugTraceTarget, scope: string, fields?: TraceFields) => void;
}

export interface FeatureContext {
  settings: Settings;
  storagePort: StoragePort;
  domBus: DomEventBus | null;
  logger: Logger;
  keyState: KeyState;
  helpers: {
    waitPresent: (
      sel: string,
      root?: Document | Element,
      timeoutMs?: number
    ) => Promise<Element | null>;
    waitGone: (sel: string, root?: Document | Element, timeoutMs?: number) => Promise<boolean>;
    humanClick: (el: HTMLElement | null, why: string) => boolean;
    debounceScheduler: (
      fn: () => void,
      delayMs: number
    ) => { schedule: () => void; cancel: () => void };
    createRafScheduler: (fn: () => void) => { schedule: () => void; cancel: () => void };
    observe: (
      root: Element,
      cb: (records: MutationRecord[]) => void,
      options?: MutationObserverInit
    ) => { observer: MutationObserver; disconnect: () => void };
    extractAddedElements: (records: MutationRecord[]) => Element[];
    onPathChange: (cb: (path: string) => void) => () => void;
    safeQuery: <T extends Element = Element>(sel: string, root?: Document | Element) => T | null;
  };
}

export interface FeatureStatus {
  active: boolean;
  details?: string;
}

export interface FeatureHandle {
  name: string;
  dispose: () => void;
  onSettingsChange?: (next: Settings, prev: Settings) => void;
  getStatus?: () => FeatureStatus;
  __test?: Record<string, unknown>;
}

function short(value: string, n = 140) {
  if (value == null) return "";
  const t = String(value).replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  return t.slice(0, n) + "...";
}

function describeEl(el: Element | null) {
  if (!el) return "null";
  const tag = el.tagName ? el.tagName.toLowerCase() : "node";
  const id = (el as HTMLElement).id ? `#${(el as HTMLElement).id}` : "";
  const dt = el.getAttribute ? el.getAttribute("data-testid") : "";
  const aria = el.getAttribute ? el.getAttribute("aria-label") : "";
  const title = el.getAttribute ? el.getAttribute("title") : "";
  const txt = el.textContent ? short(el.textContent, 60) : "";
  const bits: string[] = [];
  bits.push(`${tag}${id}`);
  if (dt) bits.push(`data-testid=${dt}`);
  if (aria) bits.push(`aria="${short(aria, 60)}"`);
  if (title) bits.push(`title="${short(title, 60)}"`);
  if (txt) bits.push(`text="${txt}"`);
  return bits.join(" ");
}

export function createLogger(debugEnabled: boolean, getSettings: () => Settings) {
  const BOOT_T0 = performance.now();
  let logCount = 0;
  let traceCount = 0;

  const nowMs = () => (performance.now() - BOOT_T0) | 0;

  const debug = (scope: string, message: string, fields?: LogFields) => {
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
      const parts: string[] = [];
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

  const isTraceEnabled = (target: DebugTraceTarget) => {
    const settings = getSettings();
    return !!settings.debugAutoExpandProjects && settings.debugTraceTarget === target;
  };

  const formatTraceValue = (value: unknown): string => {
    if (value == null) return String(value);
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
      return String(value);
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return '""';
      return /^[\w./:@+-]+$/.test(trimmed) ? short(trimmed, 140) : `"${short(trimmed, 140)}"`;
    }
    if (value instanceof Element) {
      return `"${short(describeEl(value), 180)}"`;
    }
    try {
      return `"${short(JSON.stringify(value), 180)}"`;
    } catch {
      return `"${short(String(value), 180)}"`;
    }
  };

  const formatTraceFields = (fields?: TraceFields): string => {
    if (!fields || typeof fields !== "object") return "";
    const entries = Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    if (!entries.length) return "";
    return entries.map(([key, value]) => `${key}=${formatTraceValue(value)}`).join(" ");
  };

  const trace = (
    target: DebugTraceTarget,
    scope: string,
    message: string,
    fields?: TraceFields,
    level: TraceLevel = "log"
  ) => {
    if (!isTraceEnabled(target)) return;
    traceCount += 1;
    const t = String(nowMs()).padStart(6, " ");
    const tail = formatTraceFields(fields);
    const line = `[TM Trace][${target}] #${traceCount} +${t}ms ${scope}: ${message}${
      tail ? ` | ${tail}` : ""
    }`;
    if (level === "warn") {
      console.warn(line);
      return;
    }
    if (level === "info") {
      console.info(line);
      return;
    }
    if (level === "error") {
      console.error(line);
      return;
    }
    console.log(line);
  };

  const contractSnapshot = (target: DebugTraceTarget, scope: string, fields?: TraceFields) => {
    const fallbackPath =
      typeof location !== "undefined" && typeof location.pathname === "string"
        ? location.pathname
        : "";
    trace(target, scope, "contract snapshot", {
      path: fallbackPath,
      mode: "unknown",
      dictationState: "n/a",
      composerKind: "n/a",
      sendButtonState: "n/a",
      ...(fields ?? {})
    });
  };

  return { isEnabled: debugEnabled, debug, isTraceEnabled, trace, contractSnapshot };
}

export function createFeatureContext({
  settings,
  storagePort,
  debugEnabled
}: {
  settings: Settings;
  storagePort: StoragePort;
  debugEnabled: boolean;
}): FeatureContext {
  const logger = createLogger(debugEnabled, () => settings);

  const waitPresent = async (
    sel: string,
    root: Document | Element = document,
    timeoutMs = 2500
  ) => {
    const found = root.querySelector(sel);
    if (found) return found;

    const observedRoot = root instanceof Document ? root.documentElement : root;
    if (!observedRoot) return null;

    return await new Promise<Element | null>((resolve) => {
      let done = false;
      let timeoutId = 0;
      const observer = new MutationObserver(() => {
        if (done) return;
        const next = root.querySelector(sel);
        if (!next) return;
        done = true;
        window.clearTimeout(timeoutId);
        observer.disconnect();
        resolve(next);
      });

      timeoutId = window.setTimeout(() => {
        if (done) return;
        done = true;
        observer.disconnect();
        resolve(null);
      }, timeoutMs);

      try {
        observer.observe(observedRoot, { childList: true, subtree: true });
      } catch {
        done = true;
        window.clearTimeout(timeoutId);
        observer.disconnect();
        resolve(null);
      }
    });
  };

  const waitGone = async (sel: string, root: Document | Element = document, timeoutMs = 2500) => {
    if (!root.querySelector(sel)) return true;

    const observedRoot = root instanceof Document ? root.documentElement : root;
    if (!observedRoot) return !root.querySelector(sel);

    return await new Promise<boolean>((resolve) => {
      let done = false;
      let timeoutId = 0;
      const observer = new MutationObserver(() => {
        if (done) return;
        if (root.querySelector(sel)) return;
        done = true;
        window.clearTimeout(timeoutId);
        observer.disconnect();
        resolve(true);
      });

      timeoutId = window.setTimeout(() => {
        if (done) return;
        done = true;
        observer.disconnect();
        resolve(!root.querySelector(sel));
      }, timeoutMs);

      try {
        observer.observe(observedRoot, { childList: true, subtree: true });
      } catch {
        done = true;
        window.clearTimeout(timeoutId);
        observer.disconnect();
        resolve(!root.querySelector(sel));
      }
    });
  };

  const humanClick = (el: HTMLElement | null, why: string) => {
    if (!el) return false;
    try {
      if (typeof el.focus === "function") el.focus();
    } catch (_) {}

    try {
      el.scrollIntoView({ block: "center", inline: "center" });
    } catch (_) {}

    const rect = el.getBoundingClientRect();
    const cx = Math.max(1, Math.floor(rect.left + rect.width / 2));
    const cy = Math.max(1, Math.floor(rect.top + rect.height / 2));
    const base = {
      bubbles: true,
      cancelable: true,
      clientX: cx,
      clientY: cy,
      button: 0,
      // Some UI handlers treat detail==0 as keyboard/programmatic activation.
      // Emit a single-click detail to better match real user interaction.
      detail: 1
    };

    const pointerDownCommon = {
      ...base,
      buttons: 1
    };
    const pointerUpCommon = {
      ...base,
      buttons: 0
    };

    try {
      el.dispatchEvent(
        new PointerEvent("pointerdown", {
          ...pointerDownCommon,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true
        })
      );
    } catch (_) {}
    try {
      el.dispatchEvent(new MouseEvent("mousedown", base));
    } catch (_) {}
    try {
      el.dispatchEvent(
        new PointerEvent("pointerup", {
          ...pointerUpCommon,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true
        })
      );
    } catch (_) {}
    try {
      el.dispatchEvent(new MouseEvent("mouseup", base));
    } catch (_) {}
    try {
      el.dispatchEvent(new MouseEvent("click", base));
    } catch (_) {}

    logger.debug("UI", `humanClick ${why}`, { preview: describeEl(el) });
    return true;
  };

  const debounceScheduler = (fn: () => void, delayMs: number) => {
    let timeoutId: number | null = null;
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

  const createRafScheduler = (fn: () => void) => {
    let rafId: number | null = null;
    const schedule = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        fn();
      });
    };
    const cancel = () => {
      if (rafId === null) return;
      window.cancelAnimationFrame(rafId);
      rafId = null;
    };
    return { schedule, cancel };
  };

  const observe = (
    root: Element,
    cb: (records: MutationRecord[]) => void,
    options: MutationObserverInit = { childList: true, subtree: true }
  ) => {
    const observer = new MutationObserver((records) => cb(records));
    observer.observe(root, options);
    return { observer, disconnect: () => observer.disconnect() };
  };

  const extractAddedElements = (records: MutationRecord[]) => {
    const out: Element[] = [];
    for (const record of records) {
      if (record.type !== "childList") continue;
      for (const node of Array.from(record.addedNodes)) {
        if (node instanceof Element) out.push(node);
      }
    }
    return out;
  };

  const safeQuery = <T extends Element = Element>(
    sel: string,
    root: Document | Element = document
  ) => {
    try {
      return root.querySelector<T>(sel);
    } catch (_) {
      return null;
    }
  };

  return {
    settings,
    storagePort,
    domBus: null,
    logger,
    keyState: { shift: false, ctrl: false, alt: false },
    helpers: {
      waitPresent,
      waitGone,
      humanClick,
      debounceScheduler,
      createRafScheduler,
      observe,
      extractAddedElements,
      onPathChange: subscribePathChange,
      safeQuery
    }
  };
}
