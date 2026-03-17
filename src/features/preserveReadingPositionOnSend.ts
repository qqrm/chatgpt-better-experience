import { FeatureContext, FeatureHandle } from "../application/featureContext";
import {
  collectMessageElementsFromNode,
  findConversationScrollRoot,
  findMainComposerForm,
  findMainSendButton,
  findMessageTurn,
  getMessageRole
} from "./chatgptConversation";

const ACTIVE_LOCK_MAX_MS = 30_000;
const ASSISTANT_QUIET_MS = 1500;
const BOTTOM_THRESHOLD_PX = 96;

type AssistantCompletionTracker = {
  observer: MutationObserver;
  quietTimerId: number | null;
  root: HTMLElement;
  messageId: string;
};

export function initPreserveReadingPositionOnSendFeature(ctx: FeatureContext): FeatureHandle {
  const state = {
    started: false,
    lockActive: false,
    baselineTop: 0,
    lockStartedAt: 0,
    manualIntentAt: 0,
    pointerScrollActive: false,
    rafId: null as number | null,
    timeoutId: null as number | null,
    scrollRoot: null as HTMLElement | null,
    assistantTracker: null as AssistantCompletionTracker | null,
    unsubMainDelta: null as (() => void) | null,
    unsubRoots: null as (() => void) | null
  };

  const clearAssistantTracker = () => {
    const tracker = state.assistantTracker;
    if (!tracker) return;
    if (tracker.quietTimerId !== null) {
      window.clearTimeout(tracker.quietTimerId);
    }
    tracker.observer.disconnect();
    state.assistantTracker = null;
  };

  const deactivateLock = () => {
    state.lockActive = false;
    state.manualIntentAt = 0;
    state.pointerScrollActive = false;
    if (state.rafId !== null) {
      window.cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    if (state.timeoutId !== null) {
      window.clearTimeout(state.timeoutId);
      state.timeoutId = null;
    }
    clearAssistantTracker();
  };

  const markManualIntent = () => {
    if (!state.lockActive) return;
    state.manualIntentAt = performance.now();
  };

  const enforceLock = () => {
    if (!state.lockActive) return;
    const root = state.scrollRoot;
    if (!root || !root.isConnected) {
      deactivateLock();
      return;
    }

    if (performance.now() - state.lockStartedAt > ACTIVE_LOCK_MAX_MS) {
      deactivateLock();
      return;
    }

    if (Math.abs(root.scrollTop - state.baselineTop) > 1) {
      if (state.pointerScrollActive || performance.now() - state.manualIntentAt < 450) {
        deactivateLock();
        return;
      }

      root.scrollTop = state.baselineTop;
    }

    state.rafId = window.requestAnimationFrame(enforceLock);
  };

  const scheduleAssistantCompletion = () => {
    const tracker = state.assistantTracker;
    if (!tracker) return;
    if (tracker.quietTimerId !== null) {
      window.clearTimeout(tracker.quietTimerId);
    }
    tracker.quietTimerId = window.setTimeout(() => {
      deactivateLock();
    }, ASSISTANT_QUIET_MS);
  };

  const trackAssistantMessage = (messageEl: HTMLElement) => {
    if (!state.lockActive || state.assistantTracker) return;
    const messageId = messageEl.getAttribute("data-message-id");
    if (!messageId) return;

    const root = findMessageTurn(messageEl) ?? messageEl;
    const observer = new MutationObserver(() => {
      scheduleAssistantCompletion();
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true
    });

    state.assistantTracker = {
      observer,
      quietTimerId: null,
      root,
      messageId
    };
    scheduleAssistantCompletion();
  };

  const armLock = () => {
    if (!ctx.settings.preserveReadingPositionOnSend) return;

    const root = findConversationScrollRoot();
    if (!root) return;

    const distanceFromBottom = root.scrollHeight - root.clientHeight - root.scrollTop;
    if (distanceFromBottom <= BOTTOM_THRESHOLD_PX) return;

    state.scrollRoot = root;
    state.baselineTop = root.scrollTop;
    state.lockStartedAt = performance.now();
    state.manualIntentAt = 0;
    state.pointerScrollActive = false;
    state.lockActive = true;
    clearAssistantTracker();

    if (state.timeoutId !== null) {
      window.clearTimeout(state.timeoutId);
    }
    state.timeoutId = window.setTimeout(() => {
      deactivateLock();
    }, ACTIVE_LOCK_MAX_MS);

    if (state.rafId === null) {
      state.rafId = window.requestAnimationFrame(enforceLock);
    }
  };

  const isScrollKey = (event: KeyboardEvent) =>
    event.key === "PageUp" ||
    event.key === "PageDown" ||
    event.key === "Home" ||
    event.key === "End" ||
    event.key === "ArrowUp" ||
    event.key === "ArrowDown" ||
    event.key === " " ||
    event.code === "Space";

  const handleSubmit = (event: Event) => {
    const form = findMainComposerForm();
    if (!form) return;
    if (event.target !== form) return;
    armLock();
  };

  const handleClick = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLElement>("button, [role='button']");
    if (!button) return;
    const sendButton = findMainSendButton();
    if (!sendButton) return;
    if (button !== sendButton) return;
    armLock();
  };

  const handleWheel = () => markManualIntent();
  const handleTouchStart = () => markManualIntent();
  const handlePointerDown = (event: Event) => {
    if (!(event.target instanceof Element)) return;
    const root = state.scrollRoot;
    if (!root?.contains(event.target)) return;
    state.pointerScrollActive = true;
    markManualIntent();
  };
  const handlePointerUp = () => {
    state.pointerScrollActive = false;
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (isScrollKey(event)) markManualIntent();
  };

  const start = () => {
    if (state.started) return;
    state.started = true;

    window.addEventListener("submit", handleSubmit, true);
    window.addEventListener("click", handleClick, true);
    window.addEventListener("wheel", handleWheel, { capture: true, passive: true });
    window.addEventListener("touchstart", handleTouchStart, { capture: true, passive: true });
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerUp, true);
    window.addEventListener("keydown", handleKeyDown, true);

    state.unsubRoots =
      ctx.domBus?.onRoots(() => {
        state.scrollRoot = findConversationScrollRoot();
      }) ?? null;

    state.unsubMainDelta =
      ctx.domBus?.onDelta("main", (delta) => {
        if (!state.lockActive) return;
        for (const node of delta.added) {
          for (const messageEl of collectMessageElementsFromNode(node)) {
            if (getMessageRole(messageEl) !== "assistant") continue;
            trackAssistantMessage(messageEl);
          }
        }
      }) ?? null;

    state.scrollRoot = findConversationScrollRoot();
  };

  const stop = () => {
    if (!state.started) return;
    state.started = false;

    window.removeEventListener("submit", handleSubmit, true);
    window.removeEventListener("click", handleClick, true);
    window.removeEventListener("wheel", handleWheel, true);
    window.removeEventListener("touchstart", handleTouchStart, true);
    window.removeEventListener("pointerdown", handlePointerDown, true);
    window.removeEventListener("pointerup", handlePointerUp, true);
    window.removeEventListener("pointercancel", handlePointerUp, true);
    window.removeEventListener("keydown", handleKeyDown, true);

    state.unsubMainDelta?.();
    state.unsubMainDelta = null;
    state.unsubRoots?.();
    state.unsubRoots = null;
    state.scrollRoot = null;
    deactivateLock();
  };

  if (ctx.settings.preserveReadingPositionOnSend) start();

  return {
    name: "preserveReadingPositionOnSend",
    dispose: () => stop(),
    onSettingsChange: (next, prev) => {
      if (next.preserveReadingPositionOnSend === prev.preserveReadingPositionOnSend) return;
      if (next.preserveReadingPositionOnSend) start();
      else stop();
    },
    getStatus: () => ({ active: ctx.settings.preserveReadingPositionOnSend })
  };
}
