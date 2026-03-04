import { DictationInputKind } from "../domain/dictation";
import { FeatureContext, FeatureHandle, LogFields } from "../application/featureContext";
import type { Unsubscribe } from "../application/domEventBus";
import { isDisabled, isElementVisible, isVisible, norm } from "../lib/utils";
import {
  Command as AutoSendCommand,
  Event as AutoSendEvent,
  initialState as autoSendInitialState,
  isTerminalState as isAutoSendTerminalState,
  reducer as autoSendReducer
} from "./dictationAutoSend.machine";

interface DictationConfig {
  autoSendEnabled: boolean;
  allowAutoSendInCodex: boolean;
  autoSendDelayMs: number;
  finalTextTimeoutMs: number;
  finalTextQuietMs: number;
  sendAckTimeoutMs: number;
  logClicks: boolean;
}

interface InputReadResult {
  ok: boolean;
  kind: DictationInputKind;
  text: string;
}

interface WaitForFinalTextArgs {
  snapshot: string;
  timeoutMs: number;
  quietMs: number;
}

interface WaitForFinalTextResult extends InputReadResult {
  ok: boolean;
  inputOk: boolean;
}

type DictationUiState = "NONE" | "STOP" | "SUBMIT";

const TRANSCRIBE_HOOK_SOURCE = "tm-dictation-transcribe";

const DEFAULT_CONFIG: DictationConfig = {
  autoSendEnabled: true,
  allowAutoSendInCodex: true,
  autoSendDelayMs: 3000,
  finalTextTimeoutMs: 25000,
  finalTextQuietMs: 320,
  sendAckTimeoutMs: 4500,
  logClicks: true
};
const DICTATION_COOLDOWN_MS = 400;

export function shouldAutoSendFromSubmitClick(e: Pick<MouseEvent, "isTrusted" | "detail"> | null) {
  if (!e?.isTrusted) return false;
  return (e.detail ?? 0) > 0;
}

export function initDictationAutoSendFeature(ctx: FeatureContext): FeatureHandle {
  const cfg: DictationConfig = { ...DEFAULT_CONFIG };

  let inFlight = false;
  let transcribeHookInstalled = false;
  let dictationUiObserver: MutationObserver | null = null;
  let dictationUiObserverRoot: Element | null = null;
  let lastDictationUiState: DictationUiState = "NONE";
  let dictationUiSchedule: (() => void) | null = null;
  let dictationUiCancel: (() => void) | null = null;
  let lastDictationToggleAt = 0;
  let lastSubmitClickAt = 0;
  let lastDictationSubmitViaHotkeyAt = 0;
  let lastDictationSubmitViaMouseAt = 0;

  const tmLog = (scope: string, msg: string, fields?: LogFields) => {
    const isDebugEnabled =
      !!ctx.settings.debugAutoExpandProjects && ctx.settings.debugTraceTarget === "autoSend";
    if (!isDebugEnabled) return;

    const details =
      fields && typeof fields === "object"
        ? Object.entries(fields)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => `${key}=${String(value)}`)
            .join(" ")
        : "";
    const suffix = details ? ` | ${details}` : "";
    console.log(`[TM DictationAutoSend] ${scope}: ${msg}${suffix}`);
  };

  const qs = <T extends Element = Element>(sel: string, root: Document | Element = document) =>
    root.querySelector<T>(sel);

  const qsa = <T extends Element = Element>(sel: string, root: Document | Element = document) =>
    Array.from(root.querySelectorAll<T>(sel));

  const short = (value: string, n = 140) => {
    if (value == null) return "";
    const t = String(value).replace(/\s+/g, " ").trim();
    if (t.length <= n) return t;
    return t.slice(0, n) + "...";
  };

  const describeEl = (el: Element | null) => {
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
  };

  const applySettings = () => {
    cfg.autoSendEnabled = ctx.settings.autoSend;
    cfg.allowAutoSendInCodex = ctx.settings.allowAutoSendInCodex;
  };

  const findComposerRoot = (): Element | null => {
    const footer = document.querySelector('[data-testid="composer-footer-actions"]');
    if (footer)
      return footer.closest("form") ?? footer.closest('[data-testid="composer"]') ?? footer;

    const byId = document.getElementById("prompt-textarea");
    if (byId) return byId.closest("form") ?? byId.closest('[data-testid="composer"]');

    return (
      document.querySelector('form[data-testid="composer"]') ??
      document.querySelector('[data-testid="composer"]') ??
      null
    );
  };

  const findTextbox = () => {
    // Prefer the composer input, not arbitrary focused contenteditable elsewhere on the page.
    // ChatGPT can have other contenteditables (edit message, etc.) that would break AutoSend.
    const primary = findComposerInput();
    if (primary) return primary;

    const root = findComposerRoot();
    const active = document.activeElement;
    if (root && active instanceof HTMLElement) {
      const ce = active.getAttribute("contenteditable");
      if (ce === "true" && root.contains(active)) return active;
    }

    if (root) {
      const anyCe = root.querySelector('[contenteditable="true"]');
      if (anyCe instanceof HTMLElement) return anyCe;
      const textarea = root.querySelector("textarea");
      if (textarea instanceof HTMLTextAreaElement) return textarea;
    }

    return null;
  };

  const findComposerInput = () => {
    const byId = document.getElementById("prompt-textarea");
    if (byId instanceof HTMLTextAreaElement) return byId;
    if (byId instanceof HTMLElement && byId.getAttribute("contenteditable") === "true") {
      return byId;
    }

    const byTestId = document.querySelector('[data-testid="prompt-textarea"]');
    if (byTestId instanceof HTMLTextAreaElement) return byTestId;
    if (byTestId instanceof HTMLElement && byTestId.getAttribute("contenteditable") === "true") {
      return byTestId;
    }

    const textarea = document.querySelector("textarea");
    if (textarea instanceof HTMLTextAreaElement) return textarea;

    return null;
  };

  const readTextboxText = (el: HTMLTextAreaElement | HTMLElement | null) => {
    if (!el) return "";
    if (el instanceof HTMLTextAreaElement) return el.value || "";
    const tc = String(el.textContent || "");
    const it = String((el as HTMLElement).innerText || "");
    return String(tc.trim().length ? tc : it).replace(/\u00A0/g, " ");
  };

  const readInputText = (): InputReadResult => {
    const el = findTextbox();
    if (!el) return { ok: false, kind: "none", text: "" };
    const kind: DictationInputKind =
      el instanceof HTMLTextAreaElement ? "textarea" : "contenteditable";
    return { ok: true, kind, text: readTextboxText(el) };
  };

  const findSendButton = (): HTMLElement | null =>
    qs<HTMLElement>('[data-testid="send-button"]') ||
    qs<HTMLElement>("#composer-submit-button") ||
    qs<HTMLElement>("button.composer-submit-btn") ||
    qs<HTMLElement>("form button[type='submit']") ||
    qs<HTMLElement>('button[aria-label*="Send"]') ||
    qs<HTMLElement>('[role="button"][aria-label*="Send"]') ||
    qs<HTMLElement>('button[aria-label*="Отправ"]') ||
    null;

  let countdownRoot: HTMLElement | null = null;
  let countdownRing: SVGCircleElement | null = null;
  let countdownDigit: HTMLElement | null = null;

  const ensureCountdownStyle = () => {
    if (document.getElementById("tm-autosend-style")) return;
    const style = document.createElement("style");
    style.id = "tm-autosend-style";
    style.textContent = `
      #tm-autosend-countdown {
        width: 36px;
        height: 36px;
        position: relative;
        display: none;
        pointer-events: none;
        color: var(--text-secondary, var(--text-color-secondary, #9ca3af));
        opacity: 0.95;
        flex: 0 0 36px;
      }
      #tm-autosend-countdown .tm-autosend-svg {
        width: 36px;
        height: 36px;
        transform: rotate(-90deg);
      }
      #tm-autosend-countdown .tm-autosend-track {
        fill: none;
        stroke: color-mix(in srgb, currentColor 28%, transparent);
        stroke-width: 2;
      }
      #tm-autosend-countdown .tm-autosend-progress {
        fill: none;
        stroke: currentColor;
        stroke-width: 2.5;
        stroke-linecap: round;
        transition: stroke-dashoffset 80ms linear;
      }
      #tm-autosend-countdown .tm-autosend-digit {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        font-size: 12px;
        font-weight: 600;
        color: currentColor;
      }
    `;
    document.head.appendChild(style);
  };

  const ensureCountdownUi = () => {
    if (countdownRoot && document.contains(countdownRoot)) return countdownRoot;

    ensureCountdownStyle();

    const sendBtn = findSendButton();
    const isCountdownContainerSafe = (el: HTMLElement | null) => {
      if (!el) return false;
      if (!document.contains(el)) return false;

      let current: HTMLElement | null = el;
      while (current && current !== document.body) {
        const styles = getComputedStyle(current);
        if (styles.display === "none") return false;
        if (styles.visibility === "hidden") return false;
        if (styles.opacity === "0") return false;

        const hidesOverflow =
          styles.overflow === "hidden" ||
          styles.overflowX === "hidden" ||
          styles.overflowY === "hidden" ||
          styles.overflow === "clip" ||
          styles.overflowX === "clip" ||
          styles.overflowY === "clip";
        const rect = current.getBoundingClientRect();
        if (hidesOverflow && rect.width > 0 && rect.width < 36) return false;
        if (hidesOverflow && rect.height > 0 && rect.height < 36) return false;

        current = current.parentElement;
      }

      return true;
    };

    const composerInput = findComposerInput();
    const composerSelectors = [
      '[data-testid="composer-footer-actions"]',
      '[data-testid="composer-action-buttons"]',
      '[data-testid="composer"]',
      '[data-testid="composer-form"]',
      "form"
    ];
    const candidates: HTMLElement[] = [];
    const pushCandidate = (candidate: HTMLElement | null) => {
      if (!candidate || candidates.includes(candidate)) return;
      candidates.push(candidate);
    };

    pushCandidate(sendBtn?.parentElement ?? null);
    for (const selector of composerSelectors) {
      pushCandidate(sendBtn?.closest<HTMLElement>(selector) ?? null);
    }

    pushCandidate(document.querySelector<HTMLElement>('[data-testid="composer-footer-actions"]'));
    pushCandidate(document.querySelector<HTMLElement>('[data-testid="composer-action-buttons"]'));

    for (const selector of composerSelectors) {
      pushCandidate(composerInput?.closest<HTMLElement>(selector) ?? null);
    }
    pushCandidate(composerInput?.parentElement ?? null);

    const container = candidates.find((candidate) => isCountdownContainerSafe(candidate)) ?? null;
    const preferredContainer = sendBtn?.parentElement;
    if (!container) return null;

    const existing = document.getElementById("tm-autosend-countdown") as HTMLElement | null;
    if (existing) {
      countdownRoot = existing;
      countdownRing = existing.querySelector<SVGCircleElement>(".tm-autosend-progress");
      countdownDigit = existing.querySelector<HTMLElement>(".tm-autosend-digit");
      return countdownRoot;
    }

    const root = document.createElement("div");
    root.id = "tm-autosend-countdown";
    root.setAttribute("aria-hidden", "true");
    root.innerHTML = `
      <svg class="tm-autosend-svg" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
        <circle class="tm-autosend-track" cx="18" cy="18" r="15"></circle>
        <circle class="tm-autosend-progress" cx="18" cy="18" r="15"></circle>
      </svg>
      <div class="tm-autosend-digit">3</div>
    `;

    if (preferredContainer && container === preferredContainer) {
      container.insertBefore(root, container.firstChild);
    } else {
      container.appendChild(root);
    }

    countdownRoot = root;
    countdownRing = root.querySelector<SVGCircleElement>(".tm-autosend-progress");
    countdownDigit = root.querySelector<HTMLElement>(".tm-autosend-digit");
    return countdownRoot;
  };

  const showCountdown = () => {
    const root = ensureCountdownUi();
    if (!root) return;
    root.style.display = "block";
  };

  const updateCountdown = (remainingMs: number, totalMs: number) => {
    const root = ensureCountdownUi();
    if (!root) return;

    const ring = countdownRing;
    const digit = countdownDigit;
    const clampedRemaining = Math.max(0, Math.min(totalMs, remainingMs));
    const progress = totalMs > 0 ? 1 - clampedRemaining / totalMs : 1;

    if (ring) {
      const radius = Number(ring.getAttribute("r") || "15");
      const circumference = 2 * Math.PI * radius;
      ring.style.strokeDasharray = String(circumference);
      ring.style.strokeDashoffset = String(circumference * (1 - progress));
    }

    if (digit) {
      const seconds = Math.max(1, Math.ceil(clampedRemaining / 1000));
      digit.textContent = String(seconds);
    }
  };

  const hideCountdown = () => {
    if (!countdownRoot) return;
    countdownRoot.style.display = "none";
  };

  const cleanupCountdownUi = () => {
    if (countdownRoot) countdownRoot.remove();
    countdownRoot = null;
    countdownRing = null;
    countdownDigit = null;
  };

  const isSubmitDictationButton = (btn: Element | null) => {
    if (!btn) return false;

    const aRaw = btn.getAttribute("aria-label");
    const tRaw = btn.getAttribute("title");
    const dtRaw = btn.getAttribute("data-testid");
    const txtRaw = btn.textContent;

    const a = norm(aRaw).trim();
    const t = norm(tRaw).trim();
    const dt = norm(dtRaw).trim();
    const txt = norm(txtRaw).trim();

    const hasExplicitDictationMarker = [a, t, dt, txt].some((value) =>
      /dictat|dictation|microphone|диктов|микроф|голос|надикт|voice/.test(value)
    );

    const inDictationActionContainer = findDictationActionContainers().some((container) =>
      container.contains(btn)
    );

    if (a === "submit" || a === "done" || t === "done" || txt === "done") {
      if (btn.classList.contains("composer-submit-btn")) return false;
      if (hasDictationButtonNearby(btn)) return true;
      if (hasExplicitDictationMarker) return true;
      if (inDictationActionContainer) return true;
      return false;
    }

    if (a.includes("submit dictation")) return true;
    if (
      a.includes("dictation") &&
      (a.includes("submit") || a.includes("accept") || a.includes("confirm"))
    )
      return true;

    if (a.includes("готово")) return true;
    if (a.includes("подтверд")) return true;
    if (a.includes("принять")) return true;

    if (
      dt.includes("dictation") &&
      (dt.includes("submit") || dt.includes("done") || dt.includes("finish"))
    )
      return true;

    if (t.includes("submit dictation")) return true;
    if (txt.includes("submit dictation")) return true;

    return false;
  };

  const isSendButton = (btn: Element | null) => {
    if (!btn) return false;
    const sendBtn = findSendButton();
    if (sendBtn && btn === sendBtn) return true;
    if (btn instanceof HTMLButtonElement) {
      const type = norm(btn.getAttribute("type"));
      if (type === "submit") return true;
    }
    const dt = norm(btn.getAttribute("data-testid"));
    const aria = norm(btn.getAttribute("aria-label"));
    const title = norm(btn.getAttribute("title"));
    if (dt.includes("send")) return true;
    if (aria.includes("send")) return true;
    if (aria.includes("отправ")) return true;
    if (title.includes("send")) return true;
    if (title.includes("отправ")) return true;
    return false;
  };

  const isKnownComposerSendButton = (btn: Element | null) => {
    if (!btn) return false;
    if (btn instanceof HTMLElement && btn.id === "composer-submit-button") return true;

    const dt = norm(btn.getAttribute("data-testid"));
    const aria = norm(btn.getAttribute("aria-label"));
    const title = norm(btn.getAttribute("title"));
    const text = norm(btn.textContent);

    if (dt === "send-button") return true;
    if (dt.includes("composer-submit")) return true;
    if (aria.includes("send") || aria.includes("отправ")) return true;
    if (title.includes("send") || title.includes("отправ")) return true;
    if (text === "send" || text === "отправить") return true;

    return false;
  };

  const isInterestingButton = (btn: Element | null) => {
    if (!btn) return false;
    const a = norm(btn.getAttribute("aria-label"));
    const t = norm(btn.getAttribute("title"));
    const dt = norm(btn.getAttribute("data-testid"));
    if (dt.includes("send") || dt.includes("stop") || dt.includes("voice") || dt.includes("dict"))
      return true;
    if (a.includes("send") || a.includes("stop") || a.includes("dictat") || a.includes("voice"))
      return true;
    if (
      a.includes("отправ") ||
      a.includes("останов") ||
      a.includes("диктов") ||
      a.includes("микроф")
    )
      return true;
    if (t.includes("send") || t.includes("stop") || t.includes("voice") || t.includes("dict"))
      return true;
    return false;
  };

  const isCodexPath = (pathname: string) =>
    pathname.includes("/codex") || pathname.includes("/codecs");

  const findStopGeneratingButton = () => {
    const candidates = qsa<HTMLElement>("button, [role='button']").filter((b) => {
      const a = norm(b.getAttribute("aria-label"));
      const t = norm(b.getAttribute("title"));
      const dt = norm(b.getAttribute("data-testid"));
      if (dt.includes("stop")) return true;
      if (a.includes("stop generating")) return true;
      if (a.includes("stop")) return true;
      if (a.includes("останов")) return true;
      if (t.includes("stop")) return true;
      if (t.includes("останов")) return true;
      return false;
    });
    for (const b of candidates) {
      if (isVisible(b)) return b;
    }
    return null;
  };

  const isDictationHotkey = (e: KeyboardEvent) => e.code === "Space" && (e.ctrlKey || e.metaKey);

  const swallowKeyEvent = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
  };

  const isSafeToTriggerDictation = () => {
    const active = document.activeElement;
    const composerInput = findComposerInput();
    if (!composerInput || !isElementVisible(composerInput)) return false;

    if (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLElement && active.isContentEditable)
    ) {
      if (active === composerInput) return true;
      if (composerInput instanceof HTMLElement && composerInput.contains(active)) return true;
      return false;
    }

    return true;
  };

  const isVoiceModeButton = (btn: HTMLElement | null) => {
    if (!btn) return false;
    const dt = norm(btn.getAttribute("data-testid"));
    const aria = norm(btn.getAttribute("aria-label"));
    if (dt === "composer-speech-button") return true;
    if (aria.includes("voice mode")) return true;
    return false;
  };

  const isDictationButtonVisible = (btn: HTMLElement | null) => {
    if (!btn) return false;
    if (btn.offsetParent === null) return false;
    return isElementVisible(btn);
  };

  const findDictationButtonsIn = (root: Document | Element) => {
    const found: HTMLElement[] = [];
    const direct = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button[aria-label="Dictate button"], [role="button"][aria-label="Dictate button"]'
      )
    );
    for (const btn of direct) {
      if (isDictationButtonVisible(btn) && !isVoiceModeButton(btn)) {
        found.push(btn);
      }
    }

    const fallbackSelectors = [
      '[role="button"][aria-label*="dictat" i]',
      '[role="button"][aria-label*="dictation" i]',
      '[role="button"][aria-label*="диктов" i]',
      '[role="button"][aria-label*="microphone" i]',
      '[role="button"][aria-label*="голос" i]',
      '[role="button"][aria-label*="voice" i]',
      'button[aria-label*="dictat" i]',
      'button[aria-label*="dictation" i]',
      'button[aria-label*="диктов" i]',
      'button[aria-label*="microphone" i]',
      'button[aria-label*="голос" i]',
      'button[aria-label*="voice" i]'
    ];

    const candidates = Array.from(root.querySelectorAll<HTMLElement>(fallbackSelectors.join(",")));
    for (const btn of candidates) {
      if (found.includes(btn)) continue;
      if (isVoiceModeButton(btn)) continue;
      if (isDictationButtonVisible(btn)) found.push(btn);
    }

    return found;
  };

  const findDictationButtonIn = (root: Document | Element) => {
    const direct = root.querySelector<HTMLElement>(
      'button[aria-label="Dictate button"], [role="button"][aria-label="Dictate button"]'
    );
    if (direct && isDictationButtonVisible(direct) && !isVoiceModeButton(direct)) return direct;

    const fallbackSelectors = [
      '[role="button"][aria-label*="dictat" i]',
      '[role="button"][aria-label*="dictation" i]',
      '[role="button"][aria-label*="диктов" i]',
      '[role="button"][aria-label*="microphone" i]',
      '[role="button"][aria-label*="голос" i]',
      '[role="button"][aria-label*="voice" i]',
      'button[aria-label*="dictat" i]',
      'button[aria-label*="dictation" i]',
      'button[aria-label*="диктов" i]',
      'button[aria-label*="microphone" i]',
      'button[aria-label*="голос" i]',
      'button[aria-label*="voice" i]'
    ];

    const candidates = Array.from(root.querySelectorAll<HTMLElement>(fallbackSelectors.join(",")));
    for (const btn of candidates) {
      if (isVoiceModeButton(btn)) continue;
      if (isDictationButtonVisible(btn)) return btn;
    }

    return null;
  };

  const isDictationToggleButton = (btn: HTMLElement) => {
    if (isVoiceModeButton(btn)) return false;
    const aria = norm(btn.getAttribute("aria-label"));
    const title = norm(btn.getAttribute("title"));
    const dt = norm(btn.getAttribute("data-testid"));
    if (aria === "dictate button") return true;
    if (aria.includes("dictat") || aria.includes("диктов")) return true;
    if (aria.includes("microphone") || aria.includes("voice") || aria.includes("голос"))
      return true;
    if (title.includes("dictat") || title.includes("диктов")) return true;
    if (title.includes("microphone") || title.includes("voice") || title.includes("голос"))
      return true;
    if (dt.includes("dictat") || dt.includes("dictation")) return true;
    if (dt.includes("microphone") || dt.includes("voice")) return true;
    return false;
  };

  const hasDictationButtonNearby = (btn: Element) => {
    let p: HTMLElement | null = btn.parentElement;
    for (let i = 0; i < 8 && p; i += 1) {
      const candidates = Array.from(p.querySelectorAll<HTMLElement>("button, [role='button']"));
      if (candidates.some((candidate) => isDictationToggleButton(candidate))) return true;
      p = p.parentElement;
    }
    return false;
  };

  const findDictationActionContainers = () => {
    const buttons = findDictationButtonsIn(document);
    const containers = new Set<HTMLElement>();
    for (const btn of buttons) {
      let p: HTMLElement | null = btn.parentElement;
      for (let i = 0; i < 8 && p; i += 1) {
        const actionButtons = p.querySelectorAll("button, [role='button']");
        if (actionButtons.length >= 2) {
          containers.add(p);
          break;
        }
        p = p.parentElement;
      }
      if (p && !containers.has(p)) {
        containers.add(p);
      }
    }
    return Array.from(containers);
  };

  const isStopDictationButton = (btn: Element | null) => {
    if (!btn) return false;
    const aria = norm(btn.getAttribute("aria-label"));
    const title = norm(btn.getAttribute("title"));
    const dt = norm(btn.getAttribute("data-testid"));
    const text = norm(btn.textContent);
    const hasStop =
      aria.includes("stop") ||
      title.includes("stop") ||
      text.includes("stop") ||
      aria.includes("останов") ||
      title.includes("останов") ||
      text.includes("останов");
    if (!hasStop) return false;
    const hasDictation =
      aria.includes("dictation") ||
      aria.includes("record") ||
      title.includes("dictation") ||
      title.includes("record") ||
      text.includes("dictation") ||
      text.includes("record") ||
      aria.includes("диктов") ||
      title.includes("диктов") ||
      text.includes("диктов") ||
      dt.includes("dictation") ||
      dt.includes("record");
    return hasDictation;
  };

  const findStopDictationButton = (): HTMLElement | null => {
    const containers = findDictationActionContainers();
    const roots: Array<Document | Element> = containers.length > 0 ? containers : [document];
    for (const root of roots) {
      const btns = qsa<HTMLElement>("button, [role='button']", root);
      for (const b of btns) {
        if (!isStopDictationButton(b)) continue;
        if (!isVisible(b)) continue;
        return b;
      }
    }
    return null;
  };

  const findSubmitDictationButton = (): HTMLElement | null => {
    const containers = findDictationActionContainers();
    const roots: Array<Document | Element> = containers.length > 0 ? containers : [document];
    for (const root of roots) {
      const btns = qsa<HTMLElement>("button, [role='button']", root);
      for (const b of btns) {
        if (!(b instanceof HTMLElement)) continue;
        if (b instanceof HTMLButtonElement) {
          const type = norm(b.getAttribute("type"));
          if (type === "submit") continue;
        }
        if (b === findSendButton()) continue;
        if (isKnownComposerSendButton(b)) continue;
        if (!isSubmitDictationButton(b)) continue;
        if (isSendButton(b)) continue;
        if (isKnownComposerSendButton(b)) continue;
        if (!isVisible(b)) continue;
        return b;
      }
    }
    return null;
  };

  const getDictationUiState = (): DictationUiState => {
    if (findStopDictationButton()) return "STOP";
    if (findSubmitDictationButton()) return "SUBMIT";
    return "NONE";
  };

  const findDictationButton = () => {
    const direct = findDictationButtonIn(document);
    if (direct) return direct;

    const footer = document.querySelector('[data-testid="composer-footer-actions"]');
    if (!footer) return null;
    return findDictationButtonIn(footer);
  };

  const waitForDictationButton = (timeoutMs = 1500) =>
    new Promise<HTMLElement | null>((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        const btn = findDictationButton();
        if (btn) {
          resolve(btn);
          return;
        }
        if (performance.now() - t0 > timeoutMs) {
          resolve(null);
          return;
        }
        setTimeout(tick, 60);
      };
      tick();
    });

  const triggerDictationToggle = async () => {
    const btn = await waitForDictationButton(1500);
    if (!btn) {
      tmLog("KEY", "dictation button not found");
      return false;
    }
    tmLog("KEY", "dictation button found");
    btn.click();
    lastDictationToggleAt = performance.now();
    tmLog("KEY", "dictation button clicked");
    return true;
  };

  const ensureNotGenerating = (timeoutMs: number) =>
    new Promise<boolean>((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        if (!findStopGeneratingButton()) {
          resolve(true);
          return;
        }
        if (performance.now() - t0 > timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(tick, 120);
      };
      tick();
    });

  const stopGeneratingIfPossible = async (timeoutMs: number) => {
    const stopBtn = findStopGeneratingButton();
    if (!stopBtn) return true;

    tmLog("SEND", "stop generating before send", { btn: describeEl(stopBtn) });
    ctx.helpers.humanClick(stopBtn, "stop generating");

    const ok = await ensureNotGenerating(timeoutMs);
    if (!ok) {
      tmLog("SEND", "stop generating timeout");
    }
    return ok;
  };

  const waitForFinalText = ({ snapshot, timeoutMs, quietMs }: WaitForFinalTextArgs) =>
    new Promise<WaitForFinalTextResult>((resolve) => {
      const t0 = performance.now();

      const first = readInputText();
      let lastText = first.text;
      let lastChangeAt = performance.now();

      tmLog("WAIT", "waitForFinalText start", {
        timeoutMs,
        quietMs,
        inputFound: first.ok,
        inputKind: first.kind,
        snapshotLen: (snapshot || "").length,
        len: lastText.length,
        preview: lastText,
        snapshot: snapshot || ""
      });

      const tick = () => {
        const cur = readInputText();
        const v = cur.text;

        if (v !== lastText) {
          lastText = v;
          lastChangeAt = performance.now();
          tmLog("WAIT", "input changed", {
            inputFound: cur.ok,
            inputKind: cur.kind,
            len: v.length,
            preview: v
          });
        }

        const stableForMs = (performance.now() - lastChangeAt) | 0;

        const hasText = v.trim().length > 0;

        if (hasText && stableForMs >= quietMs) {
          tmLog("WAIT", "final text stable", {
            stableForMs,
            changed: true,
            finalLen: v.length,
            inputFound: cur.ok,
            inputKind: cur.kind
          });
          resolve({ ok: true, text: v, kind: cur.kind, inputOk: cur.ok });
          return;
        }

        if (performance.now() - t0 > timeoutMs) {
          tmLog("WAIT", "final text timeout", {
            changed: v.trim().length > 0,
            snapshotLen: (snapshot || "").length,
            finalLen: v.length,
            inputFound: cur.ok,
            inputKind: cur.kind,
            preview: v
          });
          resolve({ ok: false, text: v, kind: cur.kind, inputOk: cur.ok });
          return;
        }

        setTimeout(tick, 60);
      };

      tick();
    });

  const clickSendWithAck = async (ackTimeoutMs: number) => {
    const before = readInputText().text;

    const btn = findSendButton();
    if (!btn) {
      tmLog("SEND", "send button not found");
      return false;
    }
    if (isDisabled(btn)) {
      tmLog("SEND", "send button disabled", { btn: describeEl(btn) });
      return false;
    }

    // Prefer form submission when available. Some sites ignore synthetic click events.
    let submitted = false;
    const form =
      btn.closest("form") ||
      (document.querySelector('form[data-testid="composer"]') as HTMLFormElement | null);
    if (
      form &&
      typeof (form as unknown as { requestSubmit?: unknown }).requestSubmit === "function"
    ) {
      try {
        (form as HTMLFormElement).requestSubmit(btn as unknown as HTMLButtonElement);
        submitted = true;
        tmLog("SEND", "requestSubmit", { btn: describeEl(btn) });
      } catch {
        // fall back to synthetic click
      }
    }
    if (!submitted) ctx.helpers.humanClick(btn, "send");

    const t0 = performance.now();
    while (performance.now() - t0 <= ackTimeoutMs) {
      const cur = readInputText().text;
      const cleared = cur.trim().length === 0;
      const stopGen = findStopGeneratingButton();
      const ack = cleared || !!stopGen;

      if (ack) {
        tmLog("SEND", "ack ok", {
          ok: true,
          changed: cur !== before,
          len: cur.length,
          preview: cur
        });
        return true;
      }

      await new Promise((r) => setTimeout(r, 120));
    }

    const cur = readInputText().text;
    tmLog("SEND", "ack timeout", {
      ok: false,
      changed: cur !== before,
      len: cur.length,
      preview: cur
    });
    return false;
  };

  const runFlowAfterSubmitClick = async (
    submitBtnDesc: string,
    snapshotOverride?: string,
    initialShiftHeld = false
  ) => {
    if (inFlight) {
      tmLog("FLOW", "skip: inFlight already true");
      return;
    }

    inFlight = true;
    let machineState = autoSendInitialState;
    const commandQueue: AutoSendCommand[] = [];
    let shiftListenerInstalled = false;

    const machineConfig = {
      autoSendDelayMs: cfg.autoSendDelayMs,
      finalTextTimeoutMs: cfg.finalTextTimeoutMs,
      finalTextQuietMs: cfg.finalTextQuietMs,
      sendAckTimeoutMs: cfg.sendAckTimeoutMs
    };

    const step = (event: AutoSendEvent): AutoSendCommand[] => {
      const result = autoSendReducer(machineState, event, machineConfig);
      machineState = result.state;
      return result.commands;
    };

    const enqueue = (commands: AutoSendCommand[]) => {
      if (commands.length) commandQueue.push(...commands);
    };

    const enqueueWithInlineCountdownUi = (commands: AutoSendCommand[]) => {
      for (const command of commands) {
        if (command.type === "UpdateCountdown") {
          updateCountdown(command.remainingMs, command.totalMs);
          continue;
        }

        commandQueue.push(command);
      }
    };

    const enqueueWithInlineHideCountdown = (commands: AutoSendCommand[]) => {
      for (const command of commands) {
        if (command.type === "HideCountdown") {
          hideCountdown();
          continue;
        }

        commandQueue.push(command);
      }
    };

    const shiftHandler = (event: KeyboardEvent) => {
      if (event.key !== "Shift") return;
      tmLog("FLOW", "shift cancel received");
      enqueueWithInlineHideCountdown(step({ type: "ShiftPressed" }));
    };

    const runCountdownEffect = async (durationMs: number) => {
      if (durationMs <= 0) {
        enqueueWithInlineHideCountdown(
          step({ type: "CountdownFinished", nowMs: performance.now() })
        );
        return;
      }

      showCountdown();
      const tickMs = 80;
      while (machineState.kind === "Countdown") {
        const nowMs = performance.now();
        enqueueWithInlineCountdownUi(step({ type: "CountdownTick", nowMs }));
        if (machineState.kind !== "Countdown") break;

        const elapsed = nowMs - machineState.startedAtMs;
        if (elapsed >= durationMs) {
          enqueueWithInlineHideCountdown(step({ type: "CountdownFinished", nowMs }));
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, tickMs));
      }
    };

    const executeCommand = async (command: AutoSendCommand) => {
      switch (command.type) {
        case "InstallShiftListener": {
          if (!shiftListenerInstalled) {
            window.addEventListener("keydown", shiftHandler, true);
            shiftListenerInstalled = true;
          }
          return;
        }
        case "RemoveShiftListener": {
          if (shiftListenerInstalled) {
            window.removeEventListener("keydown", shiftHandler, true);
            shiftListenerInstalled = false;
          }
          return;
        }
        case "WaitForFinalText": {
          const finalRes = await waitForFinalText({
            snapshot: command.snapshot,
            timeoutMs: command.timeoutMs,
            quietMs: command.quietMs
          });

          if (!finalRes.ok) {
            enqueue(step({ type: "FinalTextFailed", reason: "timeout" }));
            return;
          }

          enqueue(
            step({
              type: "FinalTextStable",
              text: finalRes.text,
              inputKind: finalRes.kind,
              nowMs: performance.now()
            })
          );
          return;
        }
        case "ShowCountdown": {
          await runCountdownEffect(command.durationMs);
          return;
        }
        case "UpdateCountdown": {
          updateCountdown(command.remainingMs, command.totalMs);
          return;
        }
        case "HideCountdown": {
          hideCountdown();
          return;
        }
        case "StopGeneratingIfPossible": {
          const ok = await stopGeneratingIfPossible(command.timeoutMs);
          enqueue(step({ type: ok ? "StopGeneratingOk" : "StopGeneratingFailed" }));
          return;
        }
        case "ClickSendWithAck": {
          const ok = await clickSendWithAck(command.ackTimeoutMs);
          enqueue(step({ type: ok ? "SendAckOk" : "SendAckTimeout" }));
          return;
        }
        case "Log": {
          tmLog(command.scope, command.msg, command.fields);
          return;
        }
      }
    };

    try {
      if (!cfg.autoSendEnabled) {
        tmLog("FLOW", "auto-send disabled");
        return;
      }

      const snap = readInputText();
      const snapshot = snapshotOverride ?? snap.text;
      const event: AutoSendEvent = {
        type: "SubmitClicked",
        shiftKey: initialShiftHeld,
        isCodexPath: isCodexPath(location.pathname),
        allowInCodex: cfg.allowAutoSendInCodex,
        snapshot
      };

      tmLog("FLOW", "submit click flow start", {
        btn: submitBtnDesc,
        inputFound: snap.ok,
        inputKind: snap.kind,
        snapshotLen: snapshot.length,
        snapshot,
        initialShiftHeld
      });

      enqueue(step(event));

      while (commandQueue.length > 0) {
        const command = commandQueue.shift();
        if (!command) continue;
        await executeCommand(command);
      }

      if (isAutoSendTerminalState(machineState)) {
        tmLog("FLOW", "send result", {
          ok: machineState.kind === "Done",
          state: machineState.kind
        });
      }
    } catch (e) {
      tmLog("ERR", "flow exception", {
        preview: String((e && (e as Error).stack) || (e as Error).message || e)
      });
    } finally {
      hideCountdown();
      if (shiftListenerInstalled) {
        window.removeEventListener("keydown", shiftHandler, true);
      }
      inFlight = false;
      tmLog("FLOW", "submit click flow end");
    }
  };

  const installTranscribeHook = () => {
    if (transcribeHookInstalled) return;
    transcribeHookInstalled = true;

    // ChatGPT enforces a strict CSP that blocks page-level injected scripts.
    // Keep dictation feature working without injection; rely on DOM/UI state.
    tmLog("TRANSCRIBE", "page hook disabled (CSP) - using DOM/UI only");

    window.addEventListener("message", handleTranscribeMessage);
  };

  const handleTranscribeMessage = (event: MessageEvent) => {
    if (event.source !== window) return;
    const raw = event.data as unknown;
    if (!raw || typeof raw !== "object") return;
    const data = raw as { source?: string; type?: string; id?: string };
    if (data.source !== TRANSCRIBE_HOOK_SOURCE) return;
    if (!data.type || !data.id) return;

    if (data.type === "start") return;
    if (data.type !== "complete") return;

    if (!cfg.autoSendEnabled) return;

    if (isCodexPath(location.pathname) && !cfg.allowAutoSendInCodex) {
      tmLog("FLOW", "transcribe: auto-send skipped on Codex path");
      return;
    }

    if (inFlight) {
      tmLog("FLOW", "transcribe: skip, flow already in flight");
      return;
    }

    if (performance.now() - lastSubmitClickAt < 1000) {
      tmLog("FLOW", "transcribe: skip, submit recently clicked");
      return;
    }

    const now = performance.now();
    const hotkeySubmitRecent = now - lastDictationSubmitViaHotkeyAt < 1200;
    if (hotkeySubmitRecent && lastDictationSubmitViaHotkeyAt > lastDictationSubmitViaMouseAt) {
      tmLog("FLOW", "transcribe: skip, last dictation submit via hotkey");
      return;
    }

    void (async () => {
      const dictationState = getDictationUiState();
      let submitDesc = "transcribe complete";

      if (dictationState === "SUBMIT") {
        const submitBtn = findSubmitDictationButton();
        if (submitBtn) {
          submitDesc = describeEl(submitBtn);
          tmLog("FLOW", "transcribe: submit dictation", { btn: submitDesc });
          ctx.helpers.humanClick(submitBtn, "submit-dictation");
        } else {
          tmLog("FLOW", "transcribe: submit button not found");
        }
      }

      await runFlowAfterSubmitClick(submitDesc, undefined, false);
    })();
  };

  const ensureDictationUiScheduler = () => {
    if (dictationUiSchedule && dictationUiCancel) return;
    const sched = ctx.helpers.debounceScheduler(() => {
      const nextState = getDictationUiState();
      const prevState = lastDictationUiState;
      lastDictationUiState = nextState;

      if (prevState === "SUBMIT" || nextState !== "SUBMIT") return;
      if (!cfg.autoSendEnabled) return;

      if (isCodexPath(location.pathname) && !cfg.allowAutoSendInCodex) {
        tmLog("FLOW", "dictation ui: auto-send skipped on Codex path");
        return;
      }

      if (inFlight) {
        tmLog("FLOW", "dictation ui: skip, flow already in flight");
        return;
      }

      if (performance.now() - lastSubmitClickAt < 1000) {
        tmLog("FLOW", "dictation ui: skip, submit recently clicked");
        return;
      }

      const now = performance.now();
      const hotkeySubmitRecent = now - lastDictationSubmitViaHotkeyAt < 1200;
      if (hotkeySubmitRecent && lastDictationSubmitViaHotkeyAt > lastDictationSubmitViaMouseAt) {
        tmLog("FLOW", "dictation ui: skip, last dictation submit via hotkey");
        return;
      }

      const submitBtn = findSubmitDictationButton();
      let submitDesc = "dictation ui submit";
      if (submitBtn) {
        submitDesc = describeEl(submitBtn);
        tmLog("FLOW", "dictation ui: submit dictation", { btn: submitDesc });
        ctx.helpers.humanClick(submitBtn, "submit-dictation");
        lastSubmitClickAt = performance.now();
      } else {
        tmLog("FLOW", "dictation ui: submit button not found");
      }

      void runFlowAfterSubmitClick(submitDesc, undefined, false);
    }, 120);
    dictationUiSchedule = sched.schedule;
    dictationUiCancel = sched.cancel;
  };

  const findDictationObserverRoot = (): Element | null => {
    const footerActions = document.querySelector('[data-testid="composer-footer-actions"]');
    if (footerActions) return footerActions;

    const prompt = findComposerInput();
    if (prompt) {
      const form = prompt.closest("form");
      if (form) return form;
      const container = prompt.closest('[data-testid="composer"]');
      if (container) return container;
    }

    return null;
  };

  const disconnectDictationObserver = () => {
    dictationUiObserver?.disconnect();
    dictationUiObserver = null;
    dictationUiObserverRoot = null;
    dictationUiCancel?.();
  };

  const refreshDictationObserver = () => {
    if (!cfg.autoSendEnabled) {
      disconnectDictationObserver();
      lastDictationUiState = getDictationUiState();
      return;
    }

    ensureDictationUiScheduler();

    const nextRoot = findDictationObserverRoot();
    if (!nextRoot) {
      disconnectDictationObserver();
      lastDictationUiState = getDictationUiState();
      return;
    }

    if (dictationUiObserver && dictationUiObserverRoot === nextRoot) {
      dictationUiSchedule?.();
      return;
    }

    disconnectDictationObserver();
    lastDictationUiState = getDictationUiState();
    dictationUiObserverRoot = nextRoot;
    dictationUiObserver = new MutationObserver(() => {
      dictationUiSchedule?.();
    });
    dictationUiObserver.observe(nextRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label", "title", "data-testid", "class", "disabled"]
    });
    dictationUiSchedule?.();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!cfg.autoSendEnabled && !ctx.settings.startDictation) {
      return;
    }

    refreshDictationObserver();

    const submitDictationVisible = getDictationUiState() === "SUBMIT";

    // Пока видна галочка "принять диктовку", пробел не должен ничего нажимать
    if (e.code === "Space" && !e.ctrlKey && !e.metaKey && submitDictationVisible) {
      swallowKeyEvent(e);
      return;
    }

    // Пока видна галочка "принять диктовку", Ctrl+Enter должен принять диктовку и отправить сообщение
    if (submitDictationVisible && (e.ctrlKey || e.metaKey) && e.key === "Enter") {
      swallowKeyEvent(e);

      const submitBtn = findSubmitDictationButton();
      if (submitBtn) {
        tmLog("KEY", "ctrl-enter: submit dictation");
        ctx.helpers.humanClick(submitBtn, "submit-dictation");
        lastSubmitClickAt = performance.now();
      } else {
        tmLog("KEY", "ctrl-enter: submit button not found");
      }

      if (!cfg.autoSendEnabled) {
        tmLog("FLOW", "ctrl-enter: auto-send disabled");
        return;
      }

      void (async () => {
        if (!isCodexPath(location.pathname) || cfg.allowAutoSendInCodex) {
          await runFlowAfterSubmitClick("ctrl-enter dictation submit", undefined, false);
        } else {
          tmLog("FLOW", "ctrl-enter: auto-send skipped on Codex path");
        }
      })();
      return;
    }

    if (isDictationHotkey(e)) {
      tmLog("KEY", "dictation hotkey received");
      if (!ctx.settings.startDictation) return;
      if (!isSafeToTriggerDictation()) {
        tmLog("KEY", "dictation blocked by focus");
        return;
      }

      swallowKeyEvent(e);

      if (e.repeat) {
        tmLog("KEY", "dictation hotkey repeat ignored");
        return;
      }
      if (performance.now() - lastDictationToggleAt < DICTATION_COOLDOWN_MS) {
        tmLog("KEY", "dictation cooldown active");
        return;
      }

      // Если сейчас открыт UI подтверждения диктовки, Ctrl+Space завершает диктовку через галочку
      const submitBtn = findSubmitDictationButton();
      if (submitBtn) {
        tmLog("KEY", "dictation submit via hotkey", { btn: describeEl(submitBtn) });
        ctx.helpers.humanClick(submitBtn, "submit dictation via hotkey");
        lastDictationSubmitViaHotkeyAt = performance.now();
        return;
      }

      // Иначе Ctrl+Space стартует диктовку
      void triggerDictationToggle();
    }
  };

  const handleClick = (e: MouseEvent) => {
    if (!cfg.autoSendEnabled && !ctx.settings.startDictation) {
      return;
    }

    refreshDictationObserver();
    const target = e.target;
    const btn =
      target instanceof Element && target.closest
        ? target.closest("button, [role='button']")
        : null;
    if (!btn) return;

    const btnDesc = describeEl(btn);

    if (cfg.logClicks && isInterestingButton(btn)) {
      const cur = readInputText();
      tmLog("CLICK", "button click", {
        btn: btnDesc,
        inputFound: cur.ok,
        inputKind: cur.kind,
        len: cur.text.length,
        preview: cur.text
      });
    }

    if (
      btn instanceof HTMLElement &&
      !isSubmitDictationButton(btn) &&
      isDictationButtonVisible(btn) &&
      isDictationToggleButton(btn)
    ) {
      lastDictationToggleAt = performance.now();
    }

    const dictationState = getDictationUiState();
    const submitBtn = dictationState === "SUBMIT" ? findSubmitDictationButton() : null;
    const isSubmitClick =
      btn instanceof HTMLElement && (isSubmitDictationButton(btn) || btn === submitBtn);

    if (isSubmitClick) {
      // Автосенд только для настоящего клика мышью по галочке
      if (!shouldAutoSendFromSubmitClick(e) || !cfg.autoSendEnabled) {
        tmLog("FLOW", "submit dictation click ignored: not mouse click", { btn: btnDesc });
        return;
      }

      lastSubmitClickAt = performance.now();
      lastDictationSubmitViaMouseAt = performance.now();
      void (async () => {
        if (!isCodexPath(location.pathname) || cfg.allowAutoSendInCodex) {
          await runFlowAfterSubmitClick(btnDesc, undefined, e.shiftKey);
        } else {
          tmLog("FLOW", "auto-send skipped on Codex path");
        }
      })();
    }
  };

  applySettings();

  window.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("click", handleClick, true);

  installTranscribeHook();

  let unsubscribePath: Unsubscribe | null = null;

  const setPathWatcherEnabled = (enabled: boolean) => {
    if (enabled) {
      if (unsubscribePath) return;
      unsubscribePath = ctx.helpers.onPathChange(() => {
        refreshDictationObserver();
      });
      return;
    }

    if (!unsubscribePath) return;
    unsubscribePath();
    unsubscribePath = null;
  };

  setPathWatcherEnabled(cfg.autoSendEnabled);
  refreshDictationObserver();

  tmLog("BOOT", "dictation auto-send init", { preview: location.href });

  return {
    name: "dictationAutoSend",
    dispose: () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("click", handleClick, true);
      window.removeEventListener("message", handleTranscribeMessage);
      setPathWatcherEnabled(false);
      disconnectDictationObserver();
      cleanupCountdownUi();
    },
    __test: {
      runAutoSendFlow: (snapshotOverride?: string, initialShiftHeld?: boolean) =>
        runFlowAfterSubmitClick("test submit dictation", snapshotOverride, !!initialShiftHeld),
      getDictationUiState: () => getDictationUiState(),
      findSubmitDictationButton: () => findSubmitDictationButton(),
      ensureCountdownUi: () => ensureCountdownUi()
    },
    onSettingsChange: () => {
      applySettings();
      setPathWatcherEnabled(cfg.autoSendEnabled);
      refreshDictationObserver();
    },
    getStatus: () => ({
      active: true,
      details: cfg.allowAutoSendInCodex ? "codex" : "chatgpt"
    })
  };
}
