import { FeatureContext, FeatureHandle } from "../application/featureContext";
import { isElementVisible } from "../lib/utils";

const ONE_CLICK_DELETE_HOOK_MARK = "data-qqrm-oneclick-del-hooked";
const ONE_CLICK_DELETE_X_MARK = "data-qqrm-oneclick-del-x";
const ONE_CLICK_DELETE_STYLE_ID = "qqrm-oneclick-del-style";
const ONE_CLICK_DELETE_ROOT_FLAG = "data-qqrm-oneclick-deleting";
const ONE_CLICK_DELETE_BUTTON_SELECTOR =
  'button[data-testid^="history-item-"][data-testid$="-options"]';
const ONE_CLICK_DELETE_RIGHT_ZONE_PX = 38;

const ONE_CLICK_DELETE_BTN_H = 36;
const ONE_CLICK_DELETE_BTN_W = 72;
const ONE_CLICK_DELETE_X_SIZE = 26;
const ONE_CLICK_DELETE_X_RIGHT = 6;
const ONE_CLICK_DELETE_DOTS_LEFT = 10;
const ONE_CLICK_DELETE_TOOLTIP_HINT = "Hold Shift to delete";
const ONE_CLICK_DELETE_TOOLTIP_DELETE = "Delete chat";

export function initOneClickDeleteFeature(ctx: FeatureContext): FeatureHandle {
  const qsa = <T extends Element = Element>(sel: string, root: Document | Element = document) =>
    Array.from(root.querySelectorAll<T>(sel));

  const state: {
    started: boolean;
    deleting: boolean;
    observer: MutationObserver | null;
    intervalId: number | null;
  } = {
    started: false,
    deleting: false,
    observer: null,
    intervalId: null
  };

  const isMenuVisibleForDelete = (menu: Element) => {
    if (!menu) return false;
    const rect = menu.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return false;
    if (document.documentElement.getAttribute(ONE_CLICK_DELETE_ROOT_FLAG) === "1") return true;
    return isElementVisible(menu);
  };

  const waitMenuForOneClickDeleteItem = async (timeoutMs = 1500) => {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      const menus = qsa('[data-radix-menu-content][role="menu"]');
      for (const menu of menus) {
        if (!isMenuVisibleForDelete(menu)) continue;
        const item = menu.querySelector(
          'div[role="menuitem"][data-testid="delete-chat-menu-item"]'
        );
        if (item) return item;
      }
      const fallback = document.querySelector(
        'div[role="menuitem"][data-testid="delete-chat-menu-item"]'
      );
      if (fallback) return fallback;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  };

  const setOneClickDeleteDeleting = (on: boolean) => {
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
        pointer-events: none;
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
        opacity: 0 !important;
        pointer-events: none !important;
      }
      html[${ONE_CLICK_DELETE_ROOT_FLAG}="1"] [data-radix-menu-content][role="menu"]{
        opacity: 0 !important;
        pointer-events: none !important;
      }
      html[${ONE_CLICK_DELETE_ROOT_FLAG}="1"] [data-radix-popper-content-wrapper]{
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

  const getOneClickDeleteTooltip = () =>
    ctx.keyState.shift ? ONE_CLICK_DELETE_TOOLTIP_DELETE : ONE_CLICK_DELETE_TOOLTIP_HINT;

  const ensureOneClickDeleteXSpan = (btn: HTMLElement) => {
    let x = btn.querySelector<HTMLSpanElement>(`span[${ONE_CLICK_DELETE_X_MARK}="1"]`);
    if (x) return x;
    x = document.createElement("span");
    x.setAttribute(ONE_CLICK_DELETE_X_MARK, "1");
    const tooltip = getOneClickDeleteTooltip();
    x.setAttribute("aria-label", tooltip);
    x.title = tooltip;
    x.textContent = "×";
    btn.appendChild(x);
    return x;
  };

  const updateOneClickDeleteTooltipForAllButtons = () => {
    if (!ctx.settings.oneClickDelete) return;
    const tooltip = getOneClickDeleteTooltip();
    const btns = qsa<HTMLElement>(ONE_CLICK_DELETE_BUTTON_SELECTOR);
    for (const btn of btns) {
      const x = btn.querySelector<HTMLSpanElement>(`span[${ONE_CLICK_DELETE_X_MARK}="1"]`);
      if (!x) continue;
      x.title = tooltip;
      x.setAttribute("aria-label", tooltip);
    }
  };

  const clearOneClickDeleteButtons = () => {
    const btns = qsa<HTMLElement>(ONE_CLICK_DELETE_BUTTON_SELECTOR);
    for (const btn of btns) {
      btn.removeAttribute(ONE_CLICK_DELETE_HOOK_MARK);
      const x = btn.querySelector(`span[${ONE_CLICK_DELETE_X_MARK}="1"]`);
      if (x) x.remove();
    }
  };

  const hookOneClickDeleteButton = (btn: HTMLElement) => {
    if (!btn || btn.nodeType !== 1) return;
    if (btn.hasAttribute(ONE_CLICK_DELETE_HOOK_MARK)) return;
    btn.setAttribute(ONE_CLICK_DELETE_HOOK_MARK, "1");
    ensureOneClickDeleteXSpan(btn);
  };

  const isOneClickDeleteRightZone = (btn: HTMLElement, ev: MouseEvent) => {
    const rect = btn.getBoundingClientRect();
    const localX = ev.clientX - rect.left;
    return localX >= rect.width - ONE_CLICK_DELETE_RIGHT_ZONE_PX;
  };

  const runOneClickDeleteFlow = async () => {
    if (state.deleting) return;
    state.deleting = true;
    try {
      const deleteItem = await waitMenuForOneClickDeleteItem(1500);
      if (!deleteItem) return;
      setOneClickDeleteDeleting(true);
      ctx.helpers.humanClick(deleteItem as HTMLElement, "oneclick-delete-menu");

      const modal = await ctx.helpers.waitPresent(
        'div[data-testid="modal-delete-conversation-confirmation"]',
        document,
        2000
      );
      if (!modal) return;

      const confirmBtn =
        modal.querySelector('button[data-testid="delete-conversation-confirm-button"]') ||
        (await ctx.helpers.waitPresent(
          'button[data-testid="delete-conversation-confirm-button"]',
          modal,
          1500
        ));

      if (!confirmBtn) return;
      ctx.helpers.humanClick(confirmBtn as HTMLElement, "oneclick-delete-confirm");
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 120));
      setOneClickDeleteDeleting(false);
      state.deleting = false;
    }
  };

  const refreshOneClickDelete = () => {
    if (!ctx.settings.oneClickDelete) return;
    ensureOneClickDeleteStyle();
    const btns = qsa<HTMLElement>(ONE_CLICK_DELETE_BUTTON_SELECTOR);
    for (const btn of btns) hookOneClickDeleteButton(btn);
    updateOneClickDeleteTooltipForAllButtons();
  };

  const handleOneClickDeleteClick = (ev: MouseEvent) => {
    if (!ctx.settings.oneClickDelete) return;
    if (!ev.isTrusted) return;
    const target = ev.target;
    if (!(target instanceof Element) || !target.closest) return;
    const btn = target.closest(ONE_CLICK_DELETE_BUTTON_SELECTOR);
    if (!(btn instanceof HTMLElement)) return;
    if (!isOneClickDeleteRightZone(btn, ev)) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === "function") {
      ev.stopImmediatePropagation();
    }
    if (!ctx.keyState.shift) return;
    runOneClickDeleteFlow().catch(() => {});
  };

  const handleKeyStateEvent = (e: KeyboardEvent) => {
    if (e.key === "Shift") updateOneClickDeleteTooltipForAllButtons();
  };

  const handleBlur = () => updateOneClickDeleteTooltipForAllButtons();

  const startOneClickDelete = () => {
    if (state.started) return;
    state.started = true;

    document.addEventListener("click", handleOneClickDeleteClick, true);
    window.addEventListener("keydown", handleKeyStateEvent, true);
    window.addEventListener("keyup", handleKeyStateEvent, true);
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

    document.removeEventListener("click", handleOneClickDeleteClick, true);
    window.removeEventListener("keydown", handleKeyStateEvent, true);
    window.removeEventListener("keyup", handleKeyStateEvent, true);
    window.removeEventListener("blur", handleBlur, true);

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
    setOneClickDeleteDeleting(false);
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
