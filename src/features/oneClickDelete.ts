import { FeatureContext, FeatureHandle } from "../application/featureContext";

const ONE_CLICK_DELETE_HOOK_MARK = "data-qqrm-oneclick-del-hooked";
const ONE_CLICK_DELETE_X_MARK = "data-qqrm-oneclick-del-x";
const ONE_CLICK_DELETE_STYLE_ID = "cgptbe-silent-delete-style";
const ONE_CLICK_DELETE_ROOT_FLAG = "data-cgptbe-silent-delete";
const ONE_CLICK_DELETE_BUTTON_SELECTOR =
  'button[data-testid^="history-item-"][data-testid$="-options"]';

const ONE_CLICK_DELETE_BTN_H = 36;
const ONE_CLICK_DELETE_BTN_W = 72;
const ONE_CLICK_DELETE_X_SIZE = 26;
const ONE_CLICK_DELETE_X_RIGHT = 6;
const ONE_CLICK_DELETE_DOTS_LEFT = 10;
const ONE_CLICK_DELETE_HOLD_MS = 700;
const ONE_CLICK_DELETE_TOOLTIP = "Hold to delete";

export function initOneClickDeleteFeature(ctx: FeatureContext): FeatureHandle {
  const qsa = <T extends Element = Element>(sel: string, root: Document | Element = document) =>
    Array.from(root.querySelectorAll<T>(sel));

  const state: {
    started: boolean;
    deleting: boolean;
    observer: MutationObserver | null;
    intervalId: number | null;
    holdTimerId: number | null;
    holdTarget: HTMLElement | null;
    holdButton: HTMLElement | null;
    holdPointerId: number | null;
  } = {
    started: false,
    deleting: false,
    observer: null,
    intervalId: null,
    holdTimerId: null,
    holdTarget: null,
    holdButton: null,
    holdPointerId: null
  };

  const waitPresent = async <T extends Element>(
    selector: string,
    root: Document | Element = document,
    timeoutMs = 1200
  ): Promise<T | null> => {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      const el = root.querySelector<T>(selector);
      if (el) return el;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  };

  const findButtonByExactText = (root: ParentNode, text: string) => {
    const candidates = Array.from(root.querySelectorAll<HTMLElement>('button, [role="menuitem"]'));
    return (
      candidates.find((el) => el.textContent?.trim() === text) ??
      candidates.find((el) => el.textContent?.trim().toLowerCase() === text.toLowerCase())
    );
  };

  const setSilentDeleteMode = (on: boolean) => {
    if (on) document.documentElement.setAttribute(ONE_CLICK_DELETE_ROOT_FLAG, "1");
    else document.documentElement.removeAttribute(ONE_CLICK_DELETE_ROOT_FLAG);
  };

  const ensureOneClickDeleteStyle = () => {
    if (document.getElementById(ONE_CLICK_DELETE_STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = ONE_CLICK_DELETE_STYLE_ID;
    st.textContent = `
      html{
        --qqrm-danger: #d13b3b;
        --qqrm-danger-bg: rgba(209, 59, 59, 0.14);
        --qqrm-danger-border: rgba(209, 59, 59, 0.35);
        --qqrm-danger-muted: #6b7280;
        --qqrm-danger-muted-bg: rgba(107, 114, 128, 0.1);
        --qqrm-danger-muted-border: rgba(107, 114, 128, 0.28);
      }

      @media (prefers-color-scheme: dark) {
        html{
          --qqrm-danger: #f87171;
          --qqrm-danger-bg: rgba(248, 113, 113, 0.16);
          --qqrm-danger-border: rgba(248, 113, 113, 0.35);
          --qqrm-danger-muted: #9ca3af;
          --qqrm-danger-muted-bg: rgba(148, 163, 184, 0.14);
          --qqrm-danger-muted-border: rgba(148, 163, 184, 0.3);
        }
      }

      ${ONE_CLICK_DELETE_BUTTON_SELECTOR}{
        width: ${ONE_CLICK_DELETE_BTN_W}px !important;
        height: ${ONE_CLICK_DELETE_BTN_H}px !important;
        border-radius: 12px !important;
        opacity: 1 !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        position: relative !important;
        padding: 0 !important;
        overflow: hidden !important;
      }

      ${ONE_CLICK_DELETE_BUTTON_SELECTOR} svg{
        position: absolute !important;
        left: ${ONE_CLICK_DELETE_DOTS_LEFT}px !important;
        top: 50% !important;
        transform: translateY(-50%) !important;
        pointer-events: none !important;
      }

      ${ONE_CLICK_DELETE_BUTTON_SELECTOR} > span[${ONE_CLICK_DELETE_X_MARK}="1"]{
        position: absolute;
        right: ${ONE_CLICK_DELETE_X_RIGHT}px;
        top: 50%;
        transform: translateY(-50%);
        width: ${ONE_CLICK_DELETE_X_SIZE}px;
        height: ${ONE_CLICK_DELETE_X_SIZE}px;
        border-radius: 9px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        font-weight: 600;
        line-height: 18px;
        color: var(--qqrm-danger-muted, #6b7280);
        background: var(--qqrm-danger-muted-bg, rgba(107, 114, 128, 0.1));
        border: 1px solid var(--qqrm-danger-muted-border, rgba(107, 114, 128, 0.28));
        box-shadow: -1px 0 0 rgba(255, 255, 255, 0.08) inset;
        opacity: 0.0;
        transition: opacity 140ms ease, background 140ms ease, transform 140ms ease;
        user-select: none;
        pointer-events: auto;
        cursor: pointer;
      }

      ${ONE_CLICK_DELETE_BUTTON_SELECTOR} > span[${ONE_CLICK_DELETE_X_MARK}="1"]::after{
        content: "${ONE_CLICK_DELETE_TOOLTIP}";
        position: absolute;
        right: 0;
        top: -8px;
        transform: translateY(-100%);
        white-space: nowrap;
        font-size: 12px;
        line-height: 16px;
        padding: 6px 8px;
        border-radius: 8px;
        color: var(--text-primary, #e5e7eb);
        background: rgba(17, 24, 39, 0.92);
        border: 1px solid rgba(255, 255, 255, 0.10);
        opacity: 0;
        pointer-events: none;
        transition: opacity 120ms ease, transform 120ms ease;
        z-index: 99999;
      }

      ${ONE_CLICK_DELETE_BUTTON_SELECTOR} > span[${ONE_CLICK_DELETE_X_MARK}="1"]:hover::after{
        opacity: 1;
        transform: translateY(-110%);
      }

      ${ONE_CLICK_DELETE_BUTTON_SELECTOR}:hover > span[${ONE_CLICK_DELETE_X_MARK}="1"],
      ${ONE_CLICK_DELETE_BUTTON_SELECTOR}:focus-visible > span[${ONE_CLICK_DELETE_X_MARK}="1"]{
        opacity: 1.0;
        color: var(--qqrm-danger, #d13b3b);
        background: var(--qqrm-danger-bg, rgba(209, 59, 59, 0.18));
        border-color: var(--qqrm-danger-border, rgba(209, 59, 59, 0.35));
        transform: translateY(-50%) scale(1.02);
      }

      html[${ONE_CLICK_DELETE_ROOT_FLAG}="1"] div[data-testid="modal-delete-conversation-confirmation"]{
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
      html[${ONE_CLICK_DELETE_ROOT_FLAG}="1"] [role="menu"]{
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
      html[${ONE_CLICK_DELETE_ROOT_FLAG}="1"] [data-radix-popper-content-wrapper]{
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
      html[${ONE_CLICK_DELETE_ROOT_FLAG}="1"] *{
        animation-duration: 0.001ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.001ms !important;
      }
    `;
    const host = document.head ?? document.documentElement;
    if (!host) return;
    host.appendChild(st);
  };

  const removeOneClickDeleteStyle = () => {
    const st = document.getElementById(ONE_CLICK_DELETE_STYLE_ID);
    if (st) st.remove();
  };

  const ensureOneClickDeleteXSpan = (btn: HTMLElement) => {
    let x = btn.querySelector<HTMLSpanElement>(`span[${ONE_CLICK_DELETE_X_MARK}="1"]`);
    if (x) return x;
    x = document.createElement("span");
    x.setAttribute(ONE_CLICK_DELETE_X_MARK, "1");
    x.setAttribute("aria-label", ONE_CLICK_DELETE_TOOLTIP);
    x.textContent = "×";
    btn.appendChild(x);
    return x;
  };

  const clearOneClickDeleteButtons = () => {
    const btns = qsa<HTMLElement>(ONE_CLICK_DELETE_BUTTON_SELECTOR);
    for (const btn of btns) {
      btn.removeAttribute(ONE_CLICK_DELETE_HOOK_MARK);
      const x = btn.querySelector(`span[${ONE_CLICK_DELETE_X_MARK}="1"]`);
      if (x) x.remove();
    }
  };

  const swallowEvent = (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof (ev as MouseEvent).stopImmediatePropagation === "function") {
      (ev as MouseEvent).stopImmediatePropagation();
    }
  };

  const clearHoldState = () => {
    if (state.holdTimerId !== null) {
      window.clearTimeout(state.holdTimerId);
      state.holdTimerId = null;
    }
    state.holdTarget = null;
    state.holdButton = null;
    state.holdPointerId = null;
  };

  const startHoldDelete = (x: HTMLElement, btn: HTMLElement, pointerId: number | null) => {
    clearHoldState();
    state.holdTarget = x;
    state.holdButton = btn;
    state.holdPointerId = pointerId;
    state.holdTimerId = window.setTimeout(() => {
      const targetBtn = state.holdButton;
      clearHoldState();
      if (!targetBtn) return;
      runOneClickDeleteFlow(targetBtn).catch(() => {});
    }, ONE_CLICK_DELETE_HOLD_MS);
  };

  const getDeleteXFromEvent = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return null;
    return target.closest<HTMLElement>(`span[${ONE_CLICK_DELETE_X_MARK}="1"]`);
  };

  const getDeleteButtonFromX = (x: HTMLElement) =>
    x.closest<HTMLElement>(ONE_CLICK_DELETE_BUTTON_SELECTOR);

  const hookOneClickDeleteButton = (btn: HTMLElement) => {
    if (!btn || btn.nodeType !== 1) return;
    if (btn.hasAttribute(ONE_CLICK_DELETE_HOOK_MARK)) return;
    btn.setAttribute(ONE_CLICK_DELETE_HOOK_MARK, "1");
    ensureOneClickDeleteXSpan(btn);
  };

  const runOneClickDeleteFlow = async (btn: HTMLElement) => {
    if (state.deleting) return;
    state.deleting = true;
    try {
      setSilentDeleteMode(true);
      ctx.helpers.humanClick(btn, "oneclick-delete-open-menu");

      const deleteItem = await (async () => {
        const t0 = performance.now();
        while (performance.now() - t0 < 1500) {
          const menus = qsa('[role="menu"]');
          for (const menu of menus) {
            const item =
              menu.querySelector<HTMLElement>(
                'div[role="menuitem"][data-testid="delete-chat-menu-item"]'
              ) ?? findButtonByExactText(menu, "Delete");
            if (item) return item;
          }
          const fallback =
            document.querySelector<HTMLElement>(
              'div[role="menuitem"][data-testid="delete-chat-menu-item"]'
            ) ?? findButtonByExactText(document, "Delete");
          if (fallback) return fallback;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return null;
      })();

      if (!deleteItem) return;
      ctx.helpers.humanClick(deleteItem, "oneclick-delete-menu");

      const modal = await waitPresent<HTMLElement>(
        'div[data-testid="modal-delete-conversation-confirmation"]',
        document,
        1500
      );
      if (!modal) return;

      const confirmBtn =
        modal.querySelector<HTMLElement>(
          'button[data-testid="delete-conversation-confirm-button"]'
        ) ??
        (await waitPresent<HTMLElement>(
          'button[data-testid="delete-conversation-confirm-button"]',
          modal,
          1200
        )) ??
        findButtonByExactText(modal, "Delete");

      if (!confirmBtn) return;
      ctx.helpers.humanClick(confirmBtn, "oneclick-delete-confirm");
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 120));
      setSilentDeleteMode(false);
      state.deleting = false;
    }
  };

  const handlePointerDown = (ev: PointerEvent) => {
    const x = getDeleteXFromEvent(ev.target);
    if (!x) return;
    const btn = getDeleteButtonFromX(x);
    if (!btn) return;
    swallowEvent(ev);
    startHoldDelete(x, btn, ev.pointerId ?? null);
  };

  const handlePointerUp = (ev: PointerEvent) => {
    if (!state.holdTarget) return;
    if (state.holdPointerId !== null && ev.pointerId !== state.holdPointerId) return;
    swallowEvent(ev);
    clearHoldState();
  };

  const handlePointerCancel = (ev: PointerEvent) => {
    if (!state.holdTarget) return;
    if (state.holdPointerId !== null && ev.pointerId !== state.holdPointerId) return;
    swallowEvent(ev);
    clearHoldState();
  };

  const handlePointerMove = (ev: PointerEvent) => {
    if (!state.holdTarget) return;
    if (state.holdPointerId !== null && ev.pointerId !== state.holdPointerId) return;
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!el || !state.holdTarget.contains(el)) {
      clearHoldState();
    }
  };

  const handleClick = (ev: MouseEvent) => {
    const x = getDeleteXFromEvent(ev.target);
    if (!x) return;
    swallowEvent(ev);
  };

  const handleBlur = () => clearHoldState();

  const refreshOneClickDelete = () => {
    if (!ctx.settings.oneClickDelete) return;
    ensureOneClickDeleteStyle();
    const btns = qsa<HTMLElement>(ONE_CLICK_DELETE_BUTTON_SELECTOR);
    for (const btn of btns) hookOneClickDeleteButton(btn);
  };

  const startOneClickDelete = () => {
    if (state.started) return;
    state.started = true;

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("pointerup", handlePointerUp, true);
    document.addEventListener("pointercancel", handlePointerCancel, true);
    document.addEventListener("pointermove", handlePointerMove, true);
    document.addEventListener("click", handleClick, true);
    window.addEventListener("blur", handleBlur, true);

    refreshOneClickDelete();
    state.intervalId = window.setInterval(refreshOneClickDelete, 1200);

    state.observer = new MutationObserver(() => refreshOneClickDelete());
    state.observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  };

  const stopOneClickDelete = () => {
    if (!state.started) return;
    state.started = false;

    document.removeEventListener("pointerdown", handlePointerDown, true);
    document.removeEventListener("pointerup", handlePointerUp, true);
    document.removeEventListener("pointercancel", handlePointerCancel, true);
    document.removeEventListener("pointermove", handlePointerMove, true);
    document.removeEventListener("click", handleClick, true);
    window.removeEventListener("blur", handleBlur, true);
    clearHoldState();

    if (state.intervalId !== null) {
      window.clearInterval(state.intervalId);
      state.intervalId = null;
    }
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }

    clearOneClickDeleteButtons();
    removeOneClickDeleteStyle();
    setSilentDeleteMode(false);
  };

  if (ctx.settings.oneClickDelete) startOneClickDelete();

  return {
    name: "oneClickDelete",
    dispose: () => {
      stopOneClickDelete();
    },
    onSettingsChange: (next, prev) => {
      if (!prev.oneClickDelete && next.oneClickDelete) startOneClickDelete();
      if (prev.oneClickDelete && !next.oneClickDelete) stopOneClickDelete();
    },
    getStatus: () => ({ active: ctx.settings.oneClickDelete })
  };
}
