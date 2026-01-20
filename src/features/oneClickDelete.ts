import { FeatureContext, FeatureHandle } from "../application/featureContext";

const ONE_CLICK_DELETE_HOOK_MARK = "data-qqrm-oneclick-del-hooked";
const ONE_CLICK_DELETE_ARCHIVE_MARK = "data-qqrm-oneclick-archive";
const ONE_CLICK_DELETE_NATIVE_DOTS_MARK = "data-qqrm-native-dots";
const ONE_CLICK_DELETE_X_MARK = "data-qqrm-oneclick-del-x";
const ONE_CLICK_DELETE_STYLE_ID = "cgptbe-silent-delete-style";
const ONE_CLICK_DELETE_ROOT_FLAG = "data-cgptbe-silent-delete";
const ONE_CLICK_DELETE_BUTTON_SELECTOR =
  'button[data-testid^="history-item-"][data-testid$="-options"]';

const ONE_CLICK_DELETE_BTN_H = 36;
const ONE_CLICK_DELETE_BTN_W = 118;
const ONE_CLICK_DELETE_X_SIZE = 26;
const ONE_CLICK_DELETE_X_RIGHT = 6;
const ONE_CLICK_DELETE_GAP = 6;
const ONE_CLICK_DELETE_ARCHIVE_SIZE = 26;
const ONE_CLICK_DELETE_ARCHIVE_RIGHT =
  ONE_CLICK_DELETE_X_RIGHT + ONE_CLICK_DELETE_X_SIZE + ONE_CLICK_DELETE_GAP;
const ONE_CLICK_DELETE_DOTS_LEFT = 10;
const ONE_CLICK_DELETE_WIPE_MS = 4500;
const ONE_CLICK_DELETE_UNDO_TOTAL_MS = 5000;
const ONE_CLICK_DELETE_TOOLTIP = "Click to delete";
const ONE_CLICK_DELETE_ARCHIVE_TOOLTIP = "Archive";

export const buildOneClickDeleteStyleText = () => `
  html{
    --qqrm-danger: #d13b3b;
    --qqrm-danger-bg: rgba(209, 59, 59, 0.14);
    --qqrm-danger-border: rgba(209, 59, 59, 0.35);
    --qqrm-danger-muted: #6b7280;
    --qqrm-danger-muted-bg: rgba(107, 114, 128, 0.1);
    --qqrm-danger-muted-border: rgba(107, 114, 128, 0.28);
    --qqrm-archive: #2563eb;
    --qqrm-archive-bg: rgba(37, 99, 235, 0.14);
    --qqrm-archive-border: rgba(37, 99, 235, 0.35);
    --qqrm-archive-muted: #6b7280;
    --qqrm-archive-muted-bg: rgba(107, 114, 128, 0.1);
    --qqrm-archive-muted-border: rgba(107, 114, 128, 0.28);
  }

  @media (prefers-color-scheme: dark) {
    html{
      --qqrm-danger: #f87171;
      --qqrm-danger-bg: rgba(248, 113, 113, 0.16);
      --qqrm-danger-border: rgba(248, 113, 113, 0.35);
      --qqrm-danger-muted: #9ca3af;
      --qqrm-danger-muted-bg: rgba(148, 163, 184, 0.14);
      --qqrm-danger-muted-border: rgba(148, 163, 184, 0.3);
      --qqrm-archive: #60a5fa;
      --qqrm-archive-bg: rgba(96, 165, 250, 0.16);
      --qqrm-archive-border: rgba(96, 165, 250, 0.35);
      --qqrm-archive-muted: #9ca3af;
      --qqrm-archive-muted-bg: rgba(148, 163, 184, 0.14);
      --qqrm-archive-muted-border: rgba(148, 163, 184, 0.3);
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

  ${ONE_CLICK_DELETE_BUTTON_SELECTOR} svg[${ONE_CLICK_DELETE_NATIVE_DOTS_MARK}="1"]{
    position: absolute !important;
    left: ${ONE_CLICK_DELETE_DOTS_LEFT}px !important;
    top: 50% !important;
    transform: translateY(-50%) !important;
    pointer-events: none !important;
  }

  ${ONE_CLICK_DELETE_BUTTON_SELECTOR} > span[${ONE_CLICK_DELETE_ARCHIVE_MARK}="1"]{
    position: absolute;
    right: ${ONE_CLICK_DELETE_ARCHIVE_RIGHT}px;
    top: 50%;
    transform: translate3d(0, -50%, 0);
    width: ${ONE_CLICK_DELETE_ARCHIVE_SIZE}px;
    height: ${ONE_CLICK_DELETE_ARCHIVE_SIZE}px;
    border-radius: 9px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    font-weight: 600;
    line-height: 18px;
    color: var(--qqrm-archive-muted, #6b7280);
    background: var(--qqrm-archive-muted-bg, rgba(107, 114, 128, 0.1));
    border: 1px solid var(--qqrm-archive-muted-border, rgba(107, 114, 128, 0.28));
    box-shadow: -1px 0 0 rgba(255, 255, 255, 0.08) inset;
    opacity: 0.0;
    will-change: opacity, transform;
    transition: opacity 140ms ease, background 140ms ease;
    user-select: none;
    pointer-events: auto;
    cursor: pointer;
  }

  ${ONE_CLICK_DELETE_BUTTON_SELECTOR} > span[${ONE_CLICK_DELETE_ARCHIVE_MARK}="1"] svg{
    display: block;
  }

  ${ONE_CLICK_DELETE_BUTTON_SELECTOR} > span[${ONE_CLICK_DELETE_X_MARK}="1"]{
    position: absolute;
    right: ${ONE_CLICK_DELETE_X_RIGHT}px;
    top: 50%;
    transform: translate3d(0, -50%, 0);
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
    will-change: opacity, transform;
    transition: opacity 140ms ease, background 140ms ease;
    user-select: none;
    pointer-events: auto;
    cursor: pointer;
  }

  ${ONE_CLICK_DELETE_BUTTON_SELECTOR} > span[${ONE_CLICK_DELETE_X_MARK}="1"] svg{
    display: block;
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

  ${ONE_CLICK_DELETE_BUTTON_SELECTOR}:hover > span[${ONE_CLICK_DELETE_ARCHIVE_MARK}="1"],
  ${ONE_CLICK_DELETE_BUTTON_SELECTOR}:focus-visible > span[${ONE_CLICK_DELETE_ARCHIVE_MARK}="1"]{
    opacity: 1.0;
    color: var(--qqrm-archive, #2563eb);
    background: var(--qqrm-archive-bg, rgba(37, 99, 235, 0.18));
    border-color: var(--qqrm-archive-border, rgba(37, 99, 235, 0.35));
    transform: translate3d(0, -50%, 0);
  }

  ${ONE_CLICK_DELETE_BUTTON_SELECTOR}:hover > span[${ONE_CLICK_DELETE_X_MARK}="1"],
  ${ONE_CLICK_DELETE_BUTTON_SELECTOR}:focus-visible > span[${ONE_CLICK_DELETE_X_MARK}="1"]{
    opacity: 1.0;
    color: var(--qqrm-danger, #d13b3b);
    background: var(--qqrm-danger-bg, rgba(209, 59, 59, 0.18));
    border-color: var(--qqrm-danger-border, rgba(209, 59, 59, 0.35));
    transform: translate3d(0, -50%, 0);
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

  .group.__menu-item.hoverable.qqrm-oneclick-pending{
    position: relative !important;
  }

  .group.__menu-item.hoverable.qqrm-oneclick-pending > *:not(.qqrm-oneclick-undo-overlay){
    opacity: 0.28 !important;
  }

  .group.__menu-item.hoverable .qqrm-oneclick-undo-overlay{
    position: absolute;
    inset: 0;
    border-radius: var(--qqrm-row-radius, 14px);
    overflow: hidden;

    --qqrm-wipe-a: rgba(239,68,68,0.26);
    --qqrm-wipe-b: rgba(185,28,28,0.34);
    --qqrm-heat-1: rgba(255, 180, 60, 0.14);
    --qqrm-heat-2: rgba(239, 68, 68, 0.12);
    --qqrm-heat-3: rgba(255, 220, 120, 0.10);

    z-index: 999;

    display: grid;
    place-items: center;

    cursor: pointer;
    user-select: none;

    background: rgba(0,0,0,0.10);
    border: 1px solid rgba(255,255,255,0.08);
    backdrop-filter: blur(1.5px);
  }

  .group.__menu-item.hoverable .qqrm-oneclick-undo-overlay.qqrm-archive{
    --qqrm-wipe-a: rgba(59,130,246,0.22);
    --qqrm-wipe-b: rgba(37,99,235,0.32);
    --qqrm-heat-1: rgba(96,165,250,0.16);
    --qqrm-heat-2: rgba(59,130,246,0.14);
    --qqrm-heat-3: rgba(147,197,253,0.12);
  }

  .group.__menu-item.hoverable .qqrm-oneclick-wipe{
    position: absolute;
    inset: 0;
    border-radius: var(--qqrm-row-radius, 14px);
    overflow: hidden;

    z-index: 1;
    pointer-events: none;
  }

  .group.__menu-item.hoverable .qqrm-oneclick-wipe::before{
    content: "";
    position: absolute;
    inset: 0;

    background:
      linear-gradient(90deg,
        var(--qqrm-wipe-a, rgba(239,68,68,0.26)),
        var(--qqrm-wipe-b, rgba(185,28,28,0.34))
      ),
      radial-gradient(circle at 70% 50%, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 60%);

    transform-origin: right center;
    animation: qqrmOneClickWipeCover var(--qqrm-wipe-ms, 4500ms) linear forwards;
  }

  @keyframes qqrmOneClickWipeCover{
    from { transform: scaleX(0); }
    to   { transform: scaleX(1); }
  }

  .group.__menu-item.hoverable .qqrm-oneclick-heat{
    position: absolute;
    inset: 0;
    border-radius: var(--qqrm-row-radius, 14px);
    overflow: hidden;

    z-index: 2;
    pointer-events: none;

    opacity: 0.75;
    mix-blend-mode: screen;
  }

  .group.__menu-item.hoverable .qqrm-oneclick-heat::before{
    content: "";
    position: absolute;
    inset: -35% -35% -35% -35%;

    background:
      radial-gradient(circle at 30% 70%, var(--qqrm-heat-1, rgba(255, 180, 60, 0.14)) 0%, rgba(255, 180, 60, 0) 62%),
      radial-gradient(circle at 55% 90%, var(--qqrm-heat-2, rgba(239, 68, 68, 0.12)) 0%, rgba(239, 68, 68, 0) 68%),
      radial-gradient(circle at 75% 55%, var(--qqrm-heat-3, rgba(255, 220, 120, 0.10)) 0%, rgba(255, 220, 120, 0) 66%);

    filter: blur(12px);
    animation: qqrmOneClickHeatMove 520ms ease-in-out infinite alternate;
  }

  @keyframes qqrmOneClickHeatMove{
    from { transform: translate3d(-1.2%, 0.8%, 0) scale(1.02); opacity: 0.55; }
    to   { transform: translate3d( 1.2%, -0.8%, 0) scale(1.05); opacity: 0.85; }
  }

  .group.__menu-item.hoverable .qqrm-oneclick-undo-label{
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);

    z-index: 3;
    pointer-events: none;

    font-family: var(--qqrm-row-font-family, inherit);
    font-size: var(--qqrm-row-font-size, 13px);
    font-weight: var(--qqrm-row-font-weight, 600);
    line-height: var(--qqrm-row-line-height, 18px);
    letter-spacing: var(--qqrm-row-letter-spacing, normal);

    color: var(--text-primary, #e5e7eb);
    text-shadow: 0 2px 12px rgba(0,0,0,0.35);

    opacity: 0;
    animation: qqrmUndoIn 180ms ease forwards;
    animation-delay: 0ms;
  }

  @keyframes qqrmUndoIn{
    from{ opacity: 0; transform: translate(-50%, -50%) translateY(1px); }
    to{ opacity: 1; transform: translate(-50%, -50%) translateY(0); }
  }
`;

export function initOneClickDeleteFeature(ctx: FeatureContext): FeatureHandle {
  const qsa = <T extends Element = Element>(sel: string, root: Document | Element = document) =>
    Array.from(root.querySelectorAll<T>(sel));

  type PendingActionKind = "delete" | "archive";

  type PendingAction = {
    timerId: number;
    row: HTMLElement;
    overlay: HTMLElement;
    optionsBtn: HTMLElement;
    kind: PendingActionKind;
  };

  const state: {
    started: boolean;
    observer: MutationObserver | null;
    intervalId: number | null;
    pendingByRow: Map<HTMLElement, PendingAction>;
    deleteQueue: Promise<void>;
  } = {
    started: false,
    observer: null,
    intervalId: null,
    pendingByRow: new Map(),
    deleteQueue: Promise.resolve()
  };

  const enqueueDelete = (job: () => Promise<void>) => {
    state.deleteQueue = state.deleteQueue.then(job).catch(() => {});
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

  const findButtonByTextVariants = (root: ParentNode, variants: string[]) => {
    for (const variant of variants) {
      const match = findButtonByExactText(root, variant);
      if (match) return match;
    }
    return null;
  };

  const setSilentDeleteMode = (on: boolean) => {
    if (on) document.documentElement.setAttribute(ONE_CLICK_DELETE_ROOT_FLAG, "1");
    else document.documentElement.removeAttribute(ONE_CLICK_DELETE_ROOT_FLAG);
  };

  const ensureOneClickDeleteStyle = () => {
    if (document.getElementById(ONE_CLICK_DELETE_STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = ONE_CLICK_DELETE_STYLE_ID;
    st.textContent = buildOneClickDeleteStyleText();
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
    x.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M18 6L6 18M6 6l12 12"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
        />
      </svg>
    `;
    btn.appendChild(x);
    return x;
  };

  const ensureOneClickArchiveSpan = (btn: HTMLElement) => {
    let archive = btn.querySelector<HTMLSpanElement>(`span[${ONE_CLICK_DELETE_ARCHIVE_MARK}="1"]`);
    if (archive) return archive;
    archive = document.createElement("span");
    archive.setAttribute(ONE_CLICK_DELETE_ARCHIVE_MARK, "1");
    archive.setAttribute("aria-label", ONE_CLICK_DELETE_ARCHIVE_TOOLTIP);
    archive.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 3v10m0 0l4-4m-4 4l-4-4"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M4 17v3h16v-3"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    `;
    btn.appendChild(archive);
    return archive;
  };

  const ensureNativeDotsMark = (btn: HTMLElement) => {
    const svgs = Array.from(btn.querySelectorAll("svg"));
    const native = svgs.find(
      (svg) =>
        !svg.closest(`span[${ONE_CLICK_DELETE_X_MARK}="1"]`) &&
        !svg.closest(`span[${ONE_CLICK_DELETE_ARCHIVE_MARK}="1"]`)
    );
    if (native) native.setAttribute(ONE_CLICK_DELETE_NATIVE_DOTS_MARK, "1");
  };

  const clearOneClickDeleteButtons = () => {
    const btns = qsa<HTMLElement>(ONE_CLICK_DELETE_BUTTON_SELECTOR);
    for (const btn of btns) {
      btn.removeAttribute(ONE_CLICK_DELETE_HOOK_MARK);
      const x = btn.querySelector(`span[${ONE_CLICK_DELETE_X_MARK}="1"]`);
      if (x) x.remove();
      const archive = btn.querySelector(`span[${ONE_CLICK_DELETE_ARCHIVE_MARK}="1"]`);
      if (archive) archive.remove();
      const dots = btn.querySelector(`svg[${ONE_CLICK_DELETE_NATIVE_DOTS_MARK}="1"]`);
      if (dots) dots.removeAttribute(ONE_CLICK_DELETE_NATIVE_DOTS_MARK);
    }
  };

  const swallowEvent = (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof (ev as MouseEvent).stopImmediatePropagation === "function") {
      (ev as MouseEvent).stopImmediatePropagation();
    }
  };

  const findChatRowFromOptionsButton = (btn: HTMLElement) => {
    const row = btn.closest<HTMLElement>(".group.__menu-item.hoverable");
    return row ?? null;
  };

  const applyRowTypographyVars = (row: HTMLElement) => {
    try {
      const titleSpan = row.querySelector<HTMLElement>('.truncate span[dir="auto"]');
      if (titleSpan) {
        const cs = window.getComputedStyle(titleSpan);

        row.style.setProperty("--qqrm-row-font-family", cs.fontFamily);
        row.style.setProperty("--qqrm-row-font-size", cs.fontSize);
        row.style.setProperty("--qqrm-row-font-weight", cs.fontWeight);
        row.style.setProperty("--qqrm-row-line-height", cs.lineHeight);
        row.style.setProperty("--qqrm-row-letter-spacing", cs.letterSpacing);
      }

      const pickNativeRowBorderRadius = () => {
        const candidates: HTMLElement[] = [row];

        const first = row.firstElementChild;
        if (first instanceof HTMLElement) candidates.push(first);

        const inner = row.querySelector<HTMLElement>("a, button, [role='button'], div");
        if (inner) candidates.push(inner);

        for (const el of candidates) {
          const br = window.getComputedStyle(el).borderRadius;
          const n = Number.parseFloat(br || "0");
          if (Number.isFinite(n) && n > 0.5) return br;
        }

        return "14px";
      };

      row.style.setProperty("--qqrm-row-radius", pickNativeRowBorderRadius());
    } catch {
      // ignore
    }
  };

  const clearPendingActionForRow = (row: HTMLElement) => {
    const pending = state.pendingByRow.get(row);
    if (!pending) return;

    window.clearTimeout(pending.timerId);

    if (pending.overlay.isConnected) pending.overlay.remove();
    if (pending.row.isConnected) pending.row.classList.remove("qqrm-oneclick-pending");

    state.pendingByRow.delete(row);
  };

  const clearAllPendingActions = () => {
    for (const row of Array.from(state.pendingByRow.keys())) {
      clearPendingActionForRow(row);
    }
  };

  const cleanupDetachedPendingRows = () => {
    for (const [row] of Array.from(state.pendingByRow.entries())) {
      if (!row.isConnected) {
        state.pendingByRow.delete(row);
      }
    }
  };

  const createPendingOverlay = (row: HTMLElement, kind: PendingActionKind) => {
    const overlay = document.createElement("div");
    overlay.className = "qqrm-oneclick-undo-overlay";
    if (kind === "archive") {
      overlay.classList.add("qqrm-archive");
    }
    overlay.style.setProperty("--qqrm-wipe-ms", `${ONE_CLICK_DELETE_WIPE_MS}ms`);

    overlay.innerHTML = `
    <div class="qqrm-oneclick-wipe"></div>
    <div class="qqrm-oneclick-heat"></div>
    <div class="qqrm-oneclick-undo-label">Undo</div>
  `;

    overlay.addEventListener(
      "pointerdown",
      (ev) => {
        swallowEvent(ev);
      },
      true
    );

    overlay.addEventListener(
      "click",
      (ev) => {
        swallowEvent(ev);
        clearPendingActionForRow(row);
      },
      true
    );

    row.appendChild(overlay);
    return overlay;
  };

  const runPendingAction = (kind: PendingActionKind, optionsBtn: HTMLElement) => {
    if (kind === "archive") return runOneClickArchiveFlow(optionsBtn);
    return runOneClickDeleteFlow(optionsBtn);
  };

  const startPendingAction = (optionsBtn: HTMLElement, kind: PendingActionKind) => {
    const row = findChatRowFromOptionsButton(optionsBtn);
    if (!row) {
      enqueueDelete(() => runPendingAction(kind, optionsBtn));
      return;
    }

    applyRowTypographyVars(row);

    if (state.pendingByRow.has(row)) {
      clearPendingActionForRow(row);
    }

    row.classList.add("qqrm-oneclick-pending");
    const overlay = createPendingOverlay(row, kind);

    const timerId = window.setTimeout(() => {
      clearPendingActionForRow(row);
      enqueueDelete(() => runPendingAction(kind, optionsBtn));
    }, ONE_CLICK_DELETE_UNDO_TOTAL_MS);

    state.pendingByRow.set(row, {
      timerId,
      row,
      overlay,
      optionsBtn,
      kind
    });
  };

  const startPendingDelete = (optionsBtn: HTMLElement) => {
    startPendingAction(optionsBtn, "delete");
  };

  const startPendingArchive = (optionsBtn: HTMLElement) => {
    startPendingAction(optionsBtn, "archive");
  };

  const getDeleteXFromEvent = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return null;
    return target.closest<HTMLElement>(`span[${ONE_CLICK_DELETE_X_MARK}="1"]`);
  };

  const getArchiveFromEvent = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return null;
    return target.closest<HTMLElement>(`span[${ONE_CLICK_DELETE_ARCHIVE_MARK}="1"]`);
  };

  const getDeleteButtonFromX = (x: HTMLElement) =>
    x.closest<HTMLElement>(ONE_CLICK_DELETE_BUTTON_SELECTOR);

  const getOptionsButtonFromArchive = (archive: HTMLElement) =>
    archive.closest<HTMLElement>(ONE_CLICK_DELETE_BUTTON_SELECTOR);

  const hookOneClickDeleteButton = (btn: HTMLElement) => {
    if (!btn || btn.nodeType !== 1) return;
    if (btn.hasAttribute(ONE_CLICK_DELETE_HOOK_MARK)) return;
    btn.setAttribute(ONE_CLICK_DELETE_HOOK_MARK, "1");
    ensureOneClickDeleteXSpan(btn);
    ensureOneClickArchiveSpan(btn);
    ensureNativeDotsMark(btn);
  };

  const runOneClickDeleteFlow = async (btn: HTMLElement) => {
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
    }
  };

  const runOneClickArchiveFlow = async (btn: HTMLElement) => {
    try {
      setSilentDeleteMode(true);
      ctx.helpers.humanClick(btn, "oneclick-archive-open-menu");

      const archiveItem = await (async () => {
        const archiveTextVariants = [
          "Archive",
          "Archive chat",
          "Move to archive",
          "Архив",
          "Архивировать"
        ];
        const archiveSelectors = [
          'div[role="menuitem"][data-testid="archive-chat-menu-item"]',
          'div[role="menuitem"][data-testid="archive-chat-menuitem"]',
          'div[role="menuitem"][data-testid*="archive" i]'
        ];

        const t0 = performance.now();
        while (performance.now() - t0 < 1500) {
          const menus = qsa('[role="menu"]');
          for (const menu of menus) {
            for (const selector of archiveSelectors) {
              const item = menu.querySelector<HTMLElement>(selector);
              if (item) return item;
            }
            const byText = findButtonByTextVariants(menu, archiveTextVariants);
            if (byText) return byText;
          }
          for (const selector of archiveSelectors) {
            const fallback = document.querySelector<HTMLElement>(selector);
            if (fallback) return fallback;
          }
          const fallbackText = findButtonByTextVariants(document, archiveTextVariants);
          if (fallbackText) return fallbackText;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return null;
      })();

      if (!archiveItem) return;
      ctx.helpers.humanClick(archiveItem, "oneclick-archive-menu");

      const modal = await waitPresent<HTMLElement>(
        '[role="dialog"], [role="alertdialog"]',
        document,
        1200
      );
      if (!modal) return;

      const confirmTexts = [
        "Archive",
        "Move to archive",
        "Confirm",
        "Yes",
        "OK",
        "Сохранить",
        "Применить",
        "Отправить"
      ];

      const confirmBtn =
        modal.querySelector<HTMLElement>('button[data-testid*="confirm" i]') ??
        modal.querySelector<HTMLElement>('button[data-testid*="archive" i]') ??
        findButtonByTextVariants(modal, confirmTexts);

      if (!confirmBtn) return;
      ctx.helpers.humanClick(confirmBtn, "oneclick-archive-confirm");
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 120));
      setSilentDeleteMode(false);
    }
  };

  const handlePointerDown = (ev: PointerEvent) => {
    const archive = getArchiveFromEvent(ev.target);
    if (archive) {
      const btn = getOptionsButtonFromArchive(archive);
      if (!btn) return;
      swallowEvent(ev);
      startPendingArchive(btn);
      return;
    }

    const x = getDeleteXFromEvent(ev.target);
    if (!x) return;
    const btn = getDeleteButtonFromX(x);
    if (!btn) return;
    swallowEvent(ev);
    startPendingDelete(btn);
  };

  const handleClick = (ev: MouseEvent) => {
    const archive = getArchiveFromEvent(ev.target);
    if (archive) {
      swallowEvent(ev);
      return;
    }

    const x = getDeleteXFromEvent(ev.target);
    if (!x) return;
    swallowEvent(ev);
  };

  const handleBlur = () => {
    // Do not cancel pending deletes on focus loss
  };

  const refreshOneClickDelete = () => {
    if (!ctx.settings.oneClickDelete) return;
    ensureOneClickDeleteStyle();
    const btns = qsa<HTMLElement>(ONE_CLICK_DELETE_BUTTON_SELECTOR);
    for (const btn of btns) hookOneClickDeleteButton(btn);
    cleanupDetachedPendingRows();
  };

  const startOneClickDelete = () => {
    if (state.started) return;
    state.started = true;

    document.addEventListener("pointerdown", handlePointerDown, true);
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
    document.removeEventListener("click", handleClick, true);
    window.removeEventListener("blur", handleBlur, true);
    clearAllPendingActions();

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
