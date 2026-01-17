import { Settings } from "../domain/settings";
import { StoragePort } from "../domain/ports/storagePort";

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

export interface Logger {
  isEnabled: boolean;
  debug: (scope: string, message: string, fields?: LogFields) => void;
}

export interface FeatureContext {
  settings: Settings;
  storagePort: StoragePort;
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
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

export function createLogger(debugEnabled: boolean) {
  const BOOT_T0 = performance.now();
  let logCount = 0;

  const nowMs = () => (performance.now() - BOOT_T0) | 0;

  const debug = (scope: string, message: string, fields?: LogFields) => {
    if (!debugEnabled) return;
    logCount += 1;
    const t = String(nowMs()).padStart(6, " ");
    let tail = "";
    if (fields && typeof fields === "object") {
      const allow = [
        "heldDuring",
        "holdToSend",
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

  return { isEnabled: debugEnabled, debug };
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
  const logger = createLogger(debugEnabled);

  const waitPresent = async (
    sel: string,
    root: Document | Element = document,
    timeoutMs = 2500
  ) => {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      const el = root.querySelector(sel);
      if (el) return el;
      await sleep(25);
    }
    return null;
  };

  const waitGone = async (sel: string, root: Document | Element = document, timeoutMs = 2500) => {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      const el = root.querySelector(sel);
      if (!el) return true;
      await sleep(25);
    }
    return !root.querySelector(sel);
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
    const common = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: cx,
      clientY: cy,
      button: 0
    };

    try {
      el.dispatchEvent(
        new PointerEvent("pointerdown", {
          ...common,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true
        })
      );
    } catch (_) {}
    try {
      el.dispatchEvent(new MouseEvent("mousedown", common));
    } catch (_) {}
    try {
      el.dispatchEvent(
        new PointerEvent("pointerup", {
          ...common,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true
        })
      );
    } catch (_) {}
    try {
      el.dispatchEvent(new MouseEvent("mouseup", common));
    } catch (_) {}
    try {
      el.dispatchEvent(new MouseEvent("click", common));
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
    logger,
    keyState: { shift: false, ctrl: false, alt: false },
    helpers: { waitPresent, waitGone, humanClick, debounceScheduler, safeQuery }
  };
}
