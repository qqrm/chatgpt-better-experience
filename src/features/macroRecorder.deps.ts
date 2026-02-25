import { record } from "@rrweb/record";
import type { eventWithTime } from "@rrweb/types";
import {
  createChromeLocalStorageAdapter,
  createMacroRecorderPersistence,
  type MacroRecorderPersistence
} from "./macroRecorder.persistence";

export type RrwebStartOptions = {
  emit: (event: eventWithTime) => void;
  sampling: { mousemove: boolean; scroll: number };
  maskAllInputs: boolean;
  maskInputOptions: Record<string, boolean>;
  blockClass: string;
  maskTextSelector: string;
  slimDOMOptions: "all";
};

export interface MacroRecorderDeps {
  now(): number;
  isoNow(): string;
  pageUrl(): string;
  userAgent(): string;
  startRrweb(options: RrwebStartOptions): () => void;
  addRrwebCustomEvent(tag: string, payload: unknown): void;
  downloadJson(filename: string, payload: unknown): void;
  showToast(message: string, tone?: "active" | "neutral"): void;
  persistence: MacroRecorderPersistence;
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

export const defaultMacroRecorderDeps: MacroRecorderDeps = {
  now: () => Date.now(),
  isoNow: () => new Date().toISOString(),
  pageUrl: () => location.href,
  userAgent: () => navigator.userAgent,
  startRrweb: (options) => {
    const stop = record(options);
    return typeof stop === "function" ? stop : () => {};
  },
  addRrwebCustomEvent: (tag, payload) => {
    try {
      (
        record as typeof record & { addCustomEvent?: (tag: string, payload: unknown) => void }
      ).addCustomEvent?.(tag, payload);
    } catch {
      // rrweb custom event support varies by build; semantic log is still exported.
    }
  },
  downloadJson: (filename, payload) => {
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
  },
  showToast: (message, tone = "neutral") => {
    showRecorderToast(message, tone);
  },
  persistence: createMacroRecorderPersistence(createChromeLocalStorageAdapter())
};
