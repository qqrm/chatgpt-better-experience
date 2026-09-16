import { FeatureContext, FeatureHandle } from "../application/featureContext";
import { buildChatGptAuthHeaders, buildChatGptUrl } from "./chatgptApi";

const ONE_CLICK_DELETE_HOOK_MARK = "data-qqrm-oneclick-del-hooked";
const ONE_CLICK_DELETE_ACTIONS_MARK = "data-qqrm-oneclick-actions";
const ONE_CLICK_DELETE_ARCHIVE_MARK = "data-qqrm-oneclick-archive";
const ONE_CLICK_DELETE_NATIVE_PIN_MARK = "data-qqrm-oneclick-native-pin";
const ONE_CLICK_DELETE_ROW_MARK = "data-qqrm-oneclick-row";
const ONE_CLICK_DELETE_X_MARK = "data-qqrm-oneclick-del-x";
const ONE_CLICK_DELETE_ICON_MARK = "data-qqrm-oneclick-icon";
const ONE_CLICK_DELETE_STYLE_ID = "cgptbe-silent-delete-style";
const ONE_CLICK_DELETE_ROOT_FLAG = "data-cgptbe-silent-delete";
const ONE_CLICK_DELETE_FAST_BUTTON_SELECTOR = [
  'button.__menu-item-trailing-btn[data-trailing-button][data-testid^="history-item-"]',
  'button[data-testid^="history-item-"][data-testid$="-options"]',
  'button[data-testid="undefined-options"]'
].join(", ");
const ONE_CLICK_DELETE_BUTTON_SELECTOR = `button[${ONE_CLICK_DELETE_HOOK_MARK}="1"]`;
const ONE_CLICK_DELETE_NAV_RELEVANT_SELECTOR = [
  ONE_CLICK_DELETE_BUTTON_SELECTOR,
  "button[data-trailing-button]",
  "button.__menu-item-trailing-btn",
  "button[data-testid*='history-item' i]",
  'button[data-testid="undefined-options"]',
  "[data-sidebar-item='true']",
  ".group.__menu-item",
  "a[href^='/c/']",
  "a[href*='/c/']",
  "nav[aria-label='Chat history']"
].join(", ");

const ONE_CLICK_DELETE_ACTION_SIZE = 28;
const ONE_CLICK_DELETE_WIPE_MS = 4500;
const ONE_CLICK_DELETE_UNDO_TOTAL_MS = 5000;
const ONE_CLICK_DELETE_TOOLTIP = "Click to delete";
const ONE_CLICK_DELETE_ARCHIVE_TOOLTIP = "Archive";
// The sidebar can render long after this feature starts (document_start on a
// slow SPA load, hidden tab); re-scan a few times so quick buttons do not
// stay missing until the next mutation or settings change.
const ONE_CLICK_DELETE_WARM_UP_DELAYS_MS = [1_000, 3_000, 7_000, 15_000, 30_000];
const CHAT_CONVERSATION_ID_REGEX = /\/c\/([^/?#]+)/;
type QuickIconKind = "archive" | "delete";
type SvgIconSpec = {
  width: string;
  height: string;
  viewBox: string;
  fill: string;
  paths: Array<Record<string, string>>;
};

const SVG_NS = "http://www.w3.org/2000/svg";
const LOCAL_QUICK_ICON_SPECS: Record<QuickIconKind, SvgIconSpec> = {
  archive: {
    width: "16",
    height: "16",
    viewBox: "0 0 20 20",
    fill: "currentColor",
    paths: [
      {
        d: "M11.8 10.182a.665.665 0 0 1 0 1.302l-.134.014H8.333a.665.665 0 0 1 0-1.33h3.333z"
      },
      {
        "fill-rule": "evenodd",
        "clip-rule": "evenodd",
        d: "M15.417 2.668A2.333 2.333 0 0 1 17.749 5v.833c0 .499-.159.96-.426 1.339q.006.038.008.078v5.417c0 .689 0 1.246-.036 1.696-.033.4-.098.762-.242 1.098l-.067.143c-.265.52-.67.956-1.165 1.26l-.217.122c-.377.192-.784.271-1.242.309-.45.037-1.007.037-1.696.037H7.333c-.689 0-1.246 0-1.696-.037-.4-.033-.762-.097-1.098-.241l-.143-.068a3.17 3.17 0 0 1-1.261-1.165l-.122-.217c-.192-.377-.271-.783-.309-1.24-.037-.45-.036-1.008-.036-1.697V7.25q.002-.04.008-.08a2.3 2.3 0 0 1-.424-1.337V5a2.333 2.333 0 0 1 2.332-2.332zm.584 5.42a2.3 2.3 0 0 1-.584.077H4.584c-.203 0-.399-.029-.586-.077v4.579c0 .71 0 1.204.032 1.588.031.375.088.587.168.745l.07.126c.177.287.43.522.732.676l.13.055c.144.052.333.09.615.113.384.031.877.032 1.588.032h5.333c.71 0 1.204-.001 1.588-.032.375-.03.587-.088.745-.168l.127-.072c.287-.176.522-.428.676-.73l.055-.13c.052-.144.09-.334.113-.615.031-.384.031-.877.031-1.588zM4.584 3.998c-.553 0-1.002.449-1.002 1.002v.833c0 .553.449 1.002 1.002 1.002h10.833c.553 0 1.002-.449 1.002-1.002V5c0-.553-.45-1.002-1.002-1.002z"
      }
    ]
  },
  delete: {
    width: "16",
    height: "16",
    viewBox: "0 0 20 20",
    fill: "currentColor",
    paths: [
      {
        d: "M10.63 1.335c1.403 0 2.64.925 3.036 2.271l.215.729H17l.134.014a.665.665 0 0 1 0 1.302L17 5.665h-.346l-.797 9.326a3.165 3.165 0 0 1-3.153 2.897H7.296a3.166 3.166 0 0 1-3.113-2.594l-.04-.303-.796-9.326H3a.665.665 0 0 1 0-1.33h3.12l.214-.729.084-.248A3.165 3.165 0 0 1 9.37 1.335zM5.468 14.878l.023.176a1.835 1.835 0 0 0 1.805 1.504h5.408c.953 0 1.747-.73 1.828-1.68l.787-9.213H4.682zm2.2-2.05V8.66a.665.665 0 0 1 1.33 0v4.167a.665.665 0 0 1-1.33 0m3.334 0V8.66a.665.665 0 1 1 1.33 0v4.167a.665.665 0 0 1-1.33 0M9.37 2.664c-.763 0-1.44.47-1.712 1.173l-.049.143-.103.354h4.988l-.103-.354a1.835 1.835 0 0 0-1.761-1.316z"
      }
    ]
  }
};

function createSvgElement<T extends keyof SVGElementTagNameMap>(tag: T): SVGElementTagNameMap[T] {
  return document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[T];
}

function createSvgIcon(spec: SvgIconSpec) {
  const svg = createSvgElement("svg");
  svg.setAttribute("width", spec.width);
  svg.setAttribute("height", spec.height);
  svg.setAttribute("viewBox", spec.viewBox);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", spec.fill);

  for (const pathSpec of spec.paths) {
    const path = createSvgElement("path");
    for (const [name, value] of Object.entries(pathSpec)) {
      path.setAttribute(name, value);
    }
    svg.appendChild(path);
  }

  return svg;
}

export function createQuickIconSvg(kind: QuickIconKind) {
  return createSvgIcon(LOCAL_QUICK_ICON_SPECS[kind]);
}

export function createPendingOverlayContent() {
  const fragment = document.createDocumentFragment();

  const wipe = document.createElement("div");
  wipe.className = "qqrm-oneclick-wipe";
  fragment.appendChild(wipe);

  const heat = document.createElement("div");
  heat.className = "qqrm-oneclick-heat";
  fragment.appendChild(heat);

  const label = document.createElement("div");
  label.className = "qqrm-oneclick-undo-label";
  label.textContent = "Undo";
  fragment.appendChild(label);

  return fragment;
}

export const extractConversationIdFromRow = (row: HTMLElement | null): string | null => {
  if (!row) return null;
  const link = row.querySelector<HTMLAnchorElement>('a[href^="/c/"], a[href*="/c/"]');
  if (!link) return null;
  const href = link.getAttribute("href") ?? "";
  const match = href.match(CHAT_CONVERSATION_ID_REGEX);
  return match ? match[1] : null;
};

export const patchConversation = async (
  conversationId: string,
  payload: Record<string, unknown>
): Promise<boolean> => {
  try {
    const headers = await buildChatGptAuthHeaders({
      includeJsonContentType: true
    });
    if (!headers) return false;

    const response = await fetch(buildChatGptUrl(`/backend-api/conversation/${conversationId}`), {
      method: "PATCH",
      credentials: "include",
      headers,
      body: JSON.stringify(payload)
    });

    return response.ok;
  } catch {
    return false;
  }
};

const animateCollapseRow = async (row: HTMLElement): Promise<void> => {
  try {
    const r = row.getBoundingClientRect();
    // If the row is already detached/hidden, do nothing.
    if (r.height <= 0) return;
    row.style.willChange = "height, margin, padding, opacity";
    row.style.overflow = "hidden";
    row.style.height = `${r.height}px`;
    row.style.opacity = "1";
    row.style.transition =
      "height 180ms ease, margin 180ms ease, padding 180ms ease, opacity 160ms ease";

    // Force layout.
    void row.offsetHeight;

    row.style.opacity = "0";
    row.style.height = "0px";
    row.style.paddingTop = "0px";
    row.style.paddingBottom = "0px";
    row.style.marginTop = "0px";
    row.style.marginBottom = "0px";

    await new Promise((resolve) => window.setTimeout(resolve, 220));
  } catch {
    // ignore
  }
};

type DirectPatchResult = {
  attempted: boolean;
  ok: boolean;
};

export const directDeleteConversationFromRow = async (
  row: HTMLElement
): Promise<DirectPatchResult> => {
  const conversationId = extractConversationIdFromRow(row);
  if (!conversationId) return { attempted: false, ok: false };
  const ok = await patchConversation(conversationId, { is_visible: false });
  if (ok && row.isConnected) {
    await animateCollapseRow(row);
    if (row.isConnected) row.remove();
  }
  return { attempted: true, ok };
};

export const directArchiveConversationFromRow = async (
  row: HTMLElement
): Promise<DirectPatchResult> => {
  const conversationId = extractConversationIdFromRow(row);
  if (!conversationId) return { attempted: false, ok: false };
  const ok = await patchConversation(conversationId, { is_archived: true });
  if (ok && row.isConnected) {
    await animateCollapseRow(row);
    if (row.isConnected) row.remove();
  }
  return { attempted: true, ok };
};

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

  [${ONE_CLICK_DELETE_ACTIONS_MARK}="1"]{
    display: inline-flex !important;
    flex: none !important;
    align-items: center !important;
    gap: 2px !important;
  }

  [${ONE_CLICK_DELETE_ACTIONS_MARK}="1"] > button{
    width: ${ONE_CLICK_DELETE_ACTION_SIZE}px !important;
    height: ${ONE_CLICK_DELETE_ACTION_SIZE}px !important;
    min-width: ${ONE_CLICK_DELETE_ACTION_SIZE}px !important;
    border: 0 !important;
    border-radius: 8px !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    padding: 0 !important;
    position: relative !important;
    color: currentColor !important;
    background: transparent !important;
    box-shadow: none !important;
    cursor: pointer !important;
  }

  [${ONE_CLICK_DELETE_ACTIONS_MARK}="1"] > button:hover,
  [${ONE_CLICK_DELETE_ACTIONS_MARK}="1"] > button:focus-visible{
    background: color-mix(in srgb, currentColor 12%, transparent) !important;
    outline: none !important;
  }

  [${ONE_CLICK_DELETE_ACTIONS_MARK}="1"] > button svg{
    display: block;
    pointer-events: none;
  }

  [${ONE_CLICK_DELETE_ACTIONS_MARK}="1"] > button[${ONE_CLICK_DELETE_X_MARK}="1"]::after{
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

  [${ONE_CLICK_DELETE_ACTIONS_MARK}="1"] > button[${ONE_CLICK_DELETE_X_MARK}="1"]:hover::after{
    opacity: 1;
    transform: translateY(-110%);
  }

  button[${ONE_CLICK_DELETE_NATIVE_PIN_MARK}="1"]{
    flex: none !important;
    inline-size: ${ONE_CLICK_DELETE_ACTION_SIZE}px !important;
    block-size: ${ONE_CLICK_DELETE_ACTION_SIZE}px !important;
    min-inline-size: ${ONE_CLICK_DELETE_ACTION_SIZE}px !important;
    border: 0 !important;
    border-radius: 8px !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    padding: 0 !important;
    position: relative !important;
    color: currentColor !important;
    background: transparent !important;
    box-shadow: none !important;
    cursor: pointer !important;
  }

  button[${ONE_CLICK_DELETE_NATIVE_PIN_MARK}="1"]:hover,
  button[${ONE_CLICK_DELETE_NATIVE_PIN_MARK}="1"]:focus-visible{
    background: color-mix(in srgb, currentColor 12%, transparent) !important;
    outline: none !important;
  }

  button[${ONE_CLICK_DELETE_NATIVE_PIN_MARK}="1"] svg{
    display: block;
    pointer-events: none;
  }

  [${ONE_CLICK_DELETE_ROW_MARK}="1"] button[${ONE_CLICK_DELETE_HOOK_MARK}="1"]{
    position: absolute !important;
    inline-size: 1px !important;
    block-size: 1px !important;
    min-inline-size: 0 !important;
    min-block-size: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
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

const matchesSelectorOrDescendant = (el: Element, selector: string) => {
  try {
    return el.matches(selector) || el.querySelector(selector) !== null;
  } catch {
    return false;
  }
};

export const isOneClickDeleteRelevantNavDelta = (added: Element[], removed: Element[]) => {
  // Keep synthetic empty deltas (used in tests and some mocked integrations) as relevant.
  if (added.length === 0 && removed.length === 0) return true;

  for (const el of added) {
    if (matchesSelectorOrDescendant(el, ONE_CLICK_DELETE_NAV_RELEVANT_SELECTOR)) return true;
  }
  for (const el of removed) {
    if (matchesSelectorOrDescendant(el, ONE_CLICK_DELETE_NAV_RELEVANT_SELECTOR)) return true;
  }

  return false;
};

export function initOneClickDeleteFeature(ctx: FeatureContext): FeatureHandle {
  const qsa = <T extends Element = Element>(sel: string, root: Document | Element = document) =>
    Array.from(root.querySelectorAll<T>(sel));

  const RECENT_TTL_MS = 5 * 60 * 1000;

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
    deleteSweepSchedule: (() => void) | null;
    deleteSweepCancel: (() => void) | null;
    hookScanSchedule: (() => void) | null;
    hookScanCancel: (() => void) | null;
    deleteSweepNav: Element | null;
    unsubNavDelta: (() => void) | null;
    unsubRoots: (() => void) | null;
    warmUpTimeoutIds: number[];
    windowLoadListener: (() => void) | null;
    stats: { observerCalls: number; applyRuns: number; nodesProcessed: number };
    pendingByRow: Map<HTMLElement, PendingAction>;
    deleteQueue: Promise<void>;
    sweepTimeoutsById: Map<string, number[]>;
    recentlyDeleted: Map<string, number>;
  } = {
    started: false,
    deleteSweepSchedule: null,
    deleteSweepCancel: null,
    hookScanSchedule: null,
    hookScanCancel: null,
    deleteSweepNav: null,
    unsubNavDelta: null,
    unsubRoots: null,
    warmUpTimeoutIds: [],
    windowLoadListener: null,
    stats: { observerCalls: 0, applyRuns: 0, nodesProcessed: 0 },
    pendingByRow: new Map(),
    deleteQueue: Promise.resolve(),
    sweepTimeoutsById: new Map(),
    recentlyDeleted: new Map()
  };

  const hasHistoryMarker = (el: HTMLElement) => {
    const dataTestId = el.getAttribute("data-testid")?.toLowerCase() ?? "";
    if (dataTestId.includes("history-item")) return true;
    if (el.hasAttribute("data-sidebar-item")) return true;
    if (el.classList.contains("__menu-item")) return true;
    return false;
  };

  const findHistoryRowFromNode = (node: HTMLElement | null) => {
    if (!node) return null;
    const rowFromAnchor = node
      .closest<HTMLElement>("a[href^='/c/'], a[href*='/c/']")
      ?.closest<HTMLElement>(
        "[data-sidebar-item='true'], .group.__menu-item, [role='listitem'], li, [data-testid*='history-item' i]"
      );
    if (rowFromAnchor) return rowFromAnchor;
    const row = node.closest<HTMLElement>(
      ".group.__menu-item.hoverable, .group.__menu-item, [data-sidebar-item='true'], [data-testid*='history-item' i], [role='listitem'], li"
    );
    if (!row) return null;
    if (row.querySelector("a[href^='/c/'], a[href*='/c/']") || hasHistoryMarker(row)) return row;
    return null;
  };

  const looksLikeNativePinButton = (btn: HTMLButtonElement) => {
    const dataTestId = btn.getAttribute("data-testid")?.toLowerCase() ?? "";
    if (dataTestId.includes("pin")) return true;
    const hint = [btn.getAttribute("aria-label"), btn.getAttribute("title")]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hint.includes("pin") || hint.includes("закреп") || hint.includes("откреп");
  };

  const isHistoryRowTrailingButton = (btn: HTMLElement) => {
    if (!(btn instanceof HTMLButtonElement)) return false;
    // The native pin/unpin button can carry a history-item testid itself; it
    // must stay visible as the first quick action instead of being hooked
    // (hidden) and given its own quick-action group.
    if (looksLikeNativePinButton(btn)) return false;
    const cls = btn.className || "";
    const dataTestId = btn.getAttribute("data-testid")?.toLowerCase() ?? "";
    const looksTrailing =
      btn.hasAttribute("data-trailing-button") ||
      cls.includes("__menu-item-trailing-btn") ||
      dataTestId.includes("history-item") ||
      dataTestId.includes("options");
    if (!looksTrailing) return false;
    const row = findHistoryRowFromNode(btn);
    return Boolean(row);
  };

  const enqueueDelete = (job: () => Promise<void>) => {
    state.deleteQueue = state.deleteQueue.then(job).catch(() => {});
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

  const logDebug = (message: string) => {
    if (ctx.logger.isEnabled) ctx.logger.debug("oneClickDelete", message);
  };

  const markDeleted = (conversationId: string) => {
    state.recentlyDeleted.set(conversationId, Date.now() + RECENT_TTL_MS);
  };

  const pruneDeleted = () => {
    const now = Date.now();
    for (const [id, exp] of state.recentlyDeleted) {
      if (exp <= now) state.recentlyDeleted.delete(id);
    }
  };

  const removeConversationEverywhere = (
    conversationId: string,
    reason: string,
    root?: Document | Element
  ) => {
    const scanRoot =
      root ?? state.deleteSweepNav ?? document.querySelector('nav[aria-label="Chat history"]');
    const scanHost = scanRoot ?? document;
    const anchors = Array.from(
      scanHost.querySelectorAll<HTMLAnchorElement>('a[href^="/c/"], a[href*="/c/"]')
    );
    let removed = 0;
    for (const anchor of anchors) {
      const href = anchor.getAttribute("href") ?? "";
      const match = href.match(CHAT_CONVERSATION_ID_REGEX);
      if (!match || match[1] !== conversationId) continue;
      const container =
        anchor.closest<HTMLElement>('[data-sidebar-item="true"]') ??
        anchor.closest<HTMLElement>("li") ??
        anchor.closest<HTMLElement>('[role="listitem"]') ??
        anchor.closest<HTMLElement>(".group.__menu-item") ??
        anchor;
      if (container?.isConnected) {
        container.remove();
        removed += 1;
      }
    }
    if (ctx.logger.isEnabled) {
      ctx.logger.debug(
        "oneClickDelete",
        `removed ${removed} rows for ${conversationId} (${reason})`
      );
    }
    return removed;
  };

  const clearSweepTimeouts = (conversationId: string) => {
    const timers = state.sweepTimeoutsById.get(conversationId);
    if (!timers) return;
    for (const t of timers) window.clearTimeout(t);
    state.sweepTimeoutsById.delete(conversationId);
  };

  const scheduleSweepPasses = (conversationId: string) => {
    clearSweepTimeouts(conversationId);
    const timers: number[] = [];
    const delays = [320, 1200];
    delays.forEach((delayMs, idx) => {
      const timerId = window.setTimeout(() => {
        pruneDeleted();
        if (!state.recentlyDeleted.has(conversationId)) return;
        removeConversationEverywhere(
          conversationId,
          `post-api-delete pass ${idx + 2}`,
          state.deleteSweepNav ?? undefined
        );
      }, delayMs);
      timers.push(timerId);
    });
    state.sweepTimeoutsById.set(conversationId, timers);
  };

  const runSweep = () => {
    pruneDeleted();
    if (state.recentlyDeleted.size === 0) return;
    for (const conversationId of state.recentlyDeleted.keys()) {
      removeConversationEverywhere(
        conversationId,
        "observer sweep",
        state.deleteSweepNav ?? undefined
      );
    }
  };

  const ensureDeleteSweepScheduler = () => {
    if (state.deleteSweepSchedule && state.deleteSweepCancel) return;
    const sched = ctx.helpers.debounceScheduler(() => {
      state.deleteSweepNav = ctx.domBus?.getNavRoot() ?? null;
      runSweep();
    }, 250);
    state.deleteSweepSchedule = sched.schedule;
    state.deleteSweepCancel = sched.cancel;
  };

  const collectHookableButtons = (root: ParentNode) => {
    const fastSelector = `${ONE_CLICK_DELETE_FAST_BUTTON_SELECTOR}:not([${ONE_CLICK_DELETE_HOOK_MARK}="1"])`;
    const fastButtons = qsa<HTMLElement>(fastSelector, root as Document | Element).filter(
      isHistoryRowTrailingButton
    );
    const fallbackCandidates = qsa<HTMLElement>(
      `button[data-trailing-button], button.__menu-item-trailing-btn, button[data-testid*='history-item' i], button[data-testid="undefined-options"]`,
      root as Document | Element
    );
    const dedup = new Set<HTMLElement>(fastButtons);
    for (const btn of fallbackCandidates) {
      if (btn.hasAttribute(ONE_CLICK_DELETE_HOOK_MARK)) continue;
      if (!isHistoryRowTrailingButton(btn)) continue;
      dedup.add(btn);
    }
    return Array.from(dedup);
  };

  // React re-renders can rebuild a row around our injected quick-action group
  // (owner button replaced); drop groups whose next sibling is no longer a
  // hooked options button so rescans never stack duplicate groups.
  const pruneOrphanQuickActions = (root: Document | Element) => {
    const groups = qsa<HTMLElement>(`[${ONE_CLICK_DELETE_ACTIONS_MARK}="1"]`, root);
    for (const group of groups) {
      if (!group.isConnected) continue;
      const owner = group.nextElementSibling;
      const owned =
        owner instanceof HTMLButtonElement && owner.hasAttribute(ONE_CLICK_DELETE_HOOK_MARK);
      if (!owned) group.remove();
    }
  };

  const hookOptionsButtonsInNav = (nav: Element) => {
    pruneOrphanQuickActions(nav);
    const buttons = collectHookableButtons(nav);
    for (const button of buttons) {
      hookOneClickDeleteButton(button);
      state.stats.applyRuns += 1;
    }
  };

  const runHookScan = () => {
    const nav = ctx.domBus?.getNavRoot();
    pruneOrphanQuickActions(nav ?? document);
    const buttons = nav ? collectHookableButtons(nav) : [];
    if (buttons.length === 0) {
      buttons.push(...collectHookableButtons(document));
    }
    for (const button of buttons) {
      hookOneClickDeleteButton(button);
      state.stats.applyRuns += 1;
    }
  };

  const applyLocalQuickIcon = (span: HTMLElement, kind: QuickIconKind) => {
    if (
      span.getAttribute(ONE_CLICK_DELETE_ICON_MARK) === kind &&
      span.firstElementChild instanceof SVGElement
    ) {
      return;
    }

    span.replaceChildren(createQuickIconSvg(kind));
    span.setAttribute(ONE_CLICK_DELETE_ICON_MARK, kind);
  };

  const ensureHookScanScheduler = () => {
    if (state.hookScanSchedule && state.hookScanCancel) return;
    const sched = ctx.helpers.debounceScheduler(runHookScan, 250);
    state.hookScanSchedule = sched.schedule;
    state.hookScanCancel = sched.cancel;
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

  const ensureOneClickDeleteXButton = (actions: HTMLElement) => {
    let x = actions.querySelector<HTMLButtonElement>(`button[${ONE_CLICK_DELETE_X_MARK}="1"]`);
    if (x) {
      applyLocalQuickIcon(x, "delete");
      return x;
    }
    x = document.createElement("button");
    x.type = "button";
    x.setAttribute(ONE_CLICK_DELETE_X_MARK, "1");
    x.setAttribute("aria-label", ONE_CLICK_DELETE_TOOLTIP);
    actions.appendChild(x);
    applyLocalQuickIcon(x, "delete");
    return x;
  };

  const ensureOneClickArchiveButton = (actions: HTMLElement) => {
    let archive = actions.querySelector<HTMLButtonElement>(
      `button[${ONE_CLICK_DELETE_ARCHIVE_MARK}="1"]`
    );
    if (archive) {
      applyLocalQuickIcon(archive, "archive");
      return archive;
    }
    archive = document.createElement("button");
    archive.type = "button";
    archive.setAttribute(ONE_CLICK_DELETE_ARCHIVE_MARK, "1");
    archive.setAttribute("aria-label", ONE_CLICK_DELETE_ARCHIVE_TOOLTIP);
    actions.appendChild(archive);
    applyLocalQuickIcon(archive, "archive");
    return archive;
  };

  const findNativePinButton = (optionsBtn: HTMLElement) => {
    const host = optionsBtn.parentElement;
    if (host) {
      const candidates = Array.from(host.children).filter(
        (child): child is HTMLButtonElement =>
          child instanceof HTMLButtonElement && child !== optionsBtn
      );

      const pinByHint = candidates.find(looksLikeNativePinButton);
      if (pinByHint) return pinByHint;
      // Older sidebar DOM renders the pin button without any hint attributes.
      if (candidates.length === 1) return candidates[0];
    }

    // Newer sidebar DOM can wrap the pin button separately from the options
    // button; fall back to a hint scan across the whole history row.
    const row = findHistoryRowFromNode(optionsBtn);
    if (row) {
      const rowPin = Array.from(row.querySelectorAll<HTMLButtonElement>("button")).find(
        (btn) => btn !== optionsBtn && looksLikeNativePinButton(btn)
      );
      if (rowPin) return rowPin;
    }

    return null;
  };

  const markNativePinButton = (optionsBtn: HTMLElement) => {
    const pin = findNativePinButton(optionsBtn);
    if (pin) pin.setAttribute(ONE_CLICK_DELETE_NATIVE_PIN_MARK, "1");
  };

  const ensureQuickActions = (btn: HTMLElement) => {
    const host = btn.parentElement;
    if (!host) return null;

    let actions = Array.from(host.children).find(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.getAttribute(ONE_CLICK_DELETE_ACTIONS_MARK) === "1"
    );
    if (!actions) {
      actions = document.createElement("div");
      actions.setAttribute(ONE_CLICK_DELETE_ACTIONS_MARK, "1");
      actions.setAttribute("role", "group");
      actions.setAttribute("aria-label", "Quick chat actions");
      host.insertBefore(actions, btn);
    }

    ensureOneClickArchiveButton(actions);
    ensureOneClickDeleteXButton(actions);
    markNativePinButton(btn);
    return actions;
  };

  const clearOneClickDeleteButtons = () => {
    const btns = qsa<HTMLElement>(`button[${ONE_CLICK_DELETE_HOOK_MARK}="1"]`);
    for (const btn of btns) {
      btn.removeAttribute(ONE_CLICK_DELETE_HOOK_MARK);
      const actions = btn.previousElementSibling;
      if (actions?.getAttribute(ONE_CLICK_DELETE_ACTIONS_MARK) === "1") actions.remove();
      findNativePinButton(btn)?.removeAttribute(ONE_CLICK_DELETE_NATIVE_PIN_MARK);
      const row = findChatRowFromOptionsButton(btn);
      row?.removeAttribute(ONE_CLICK_DELETE_ROW_MARK);
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
    return findHistoryRowFromNode(btn);
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
    overlay.append(createPendingOverlayContent());

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
    return target.closest<HTMLElement>(`button[${ONE_CLICK_DELETE_X_MARK}="1"]`);
  };

  const getArchiveFromEvent = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return null;
    return target.closest<HTMLElement>(`button[${ONE_CLICK_DELETE_ARCHIVE_MARK}="1"]`);
  };

  const getOptionsButtonFromAction = (action: HTMLElement) => {
    const actions = action.closest<HTMLElement>(`[${ONE_CLICK_DELETE_ACTIONS_MARK}="1"]`);
    const btn = actions?.nextElementSibling;
    return btn instanceof HTMLElement && isHistoryRowTrailingButton(btn) ? btn : null;
  };

  const hookOneClickDeleteButton = (btn: HTMLElement) => {
    if (!btn || btn.nodeType !== 1) return;
    if (btn.hasAttribute(ONE_CLICK_DELETE_HOOK_MARK)) return;
    btn.setAttribute(ONE_CLICK_DELETE_HOOK_MARK, "1");
    ensureQuickActions(btn);
    const row = findChatRowFromOptionsButton(btn);
    row?.setAttribute(ONE_CLICK_DELETE_ROW_MARK, "1");
  };

  const runOneClickDeleteUiFlow = async (btn: HTMLElement) => {
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

      const modal = await ctx.helpers.waitPresent(
        'div[data-testid="modal-delete-conversation-confirmation"]',
        document,
        1500
      );
      if (!modal) return;

      const confirmBtn =
        modal.querySelector<HTMLElement>(
          'button[data-testid="delete-conversation-confirm-button"]'
        ) ??
        ((await ctx.helpers.waitPresent(
          'button[data-testid="delete-conversation-confirm-button"]',
          modal,
          1200
        )) as HTMLElement | null) ??
        findButtonByExactText(modal, "Delete");

      if (!confirmBtn) return;
      ctx.helpers.humanClick(confirmBtn, "oneclick-delete-confirm");
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 120));
      setSilentDeleteMode(false);
    }
  };

  const runOneClickArchiveUiFlow = async (btn: HTMLElement) => {
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

      const modal = (await ctx.helpers.waitPresent(
        '[role="dialog"], [role="alertdialog"]',
        document,
        1200
      )) as HTMLElement | null;
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

  const runOneClickDeleteFlow = async (btn: HTMLElement) => {
    const row = findChatRowFromOptionsButton(btn);
    if (!row) return;

    const conversationId = extractConversationIdFromRow(row);
    const directResult = await directDeleteConversationFromRow(row);
    if (directResult.ok) {
      logDebug("direct delete patch ok");
      if (conversationId) {
        markDeleted(conversationId);
        pruneDeleted();
        removeConversationEverywhere(conversationId, "post-api-delete pass 1");
        scheduleSweepPasses(conversationId);
      }
      return;
    }
    if (directResult.attempted) {
      logDebug("direct patch failed, fallback to UI");
    }

    await runOneClickDeleteUiFlow(btn);
  };

  const runOneClickArchiveFlow = async (btn: HTMLElement) => {
    const row = findChatRowFromOptionsButton(btn);
    if (!row) return;

    const directResult = await directArchiveConversationFromRow(row);
    if (directResult.ok) {
      logDebug("direct archive patch ok");
      return;
    }
    if (directResult.attempted) {
      logDebug("direct patch failed, fallback to UI");
    }

    await runOneClickArchiveUiFlow(btn);
  };

  const handlePointerDown = (ev: PointerEvent) => {
    const archive = getArchiveFromEvent(ev.target);
    if (archive) {
      const btn = getOptionsButtonFromAction(archive);
      if (!btn) return;
      swallowEvent(ev);
      startPendingArchive(btn);
      return;
    }

    const x = getDeleteXFromEvent(ev.target);
    if (!x) return;
    const btn = getOptionsButtonFromAction(x);
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
    cleanupDetachedPendingRows();
    const nav = ctx.domBus?.getNavRoot();
    state.deleteSweepNav = nav ?? null;
    if (nav) hookOptionsButtonsInNav(nav);
    else runHookScan();
    if (ctx.logger.isEnabled) {
      ctx.logger.debug("oneClickDelete", "refresh", {
        preview: `bus=${state.stats.observerCalls} apply=${state.stats.applyRuns} nodes=${state.stats.nodesProcessed}`
      });
    }
  };

  const startOneClickDelete = () => {
    if (state.started) return;
    state.started = true;

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("click", handleClick, true);
    window.addEventListener("blur", handleBlur, true);

    ensureDeleteSweepScheduler();
    ensureHookScanScheduler();
    refreshOneClickDelete();

    state.windowLoadListener = () => refreshOneClickDelete();
    window.addEventListener("load", state.windowLoadListener);
    state.warmUpTimeoutIds = ONE_CLICK_DELETE_WARM_UP_DELAYS_MS.map((delayMs) =>
      window.setTimeout(() => refreshOneClickDelete(), delayMs)
    );

    state.unsubRoots =
      ctx.domBus?.onRoots((roots) => {
        state.deleteSweepNav = roots.nav;
        if (roots.nav) hookOptionsButtonsInNav(roots.nav);
        else runHookScan();
      }) ?? null;

    state.unsubNavDelta =
      ctx.domBus?.onDelta("nav", (delta) => {
        state.stats.observerCalls += 1;
        state.stats.nodesProcessed += delta.added.length + delta.removed.length;
        if (!isOneClickDeleteRelevantNavDelta(delta.added, delta.removed)) return;
        state.hookScanSchedule?.();
        if (state.recentlyDeleted.size > 0) state.deleteSweepSchedule?.();
      }) ?? null;
  };

  const stopOneClickDelete = () => {
    if (!state.started) return;
    state.started = false;

    document.removeEventListener("pointerdown", handlePointerDown, true);
    document.removeEventListener("click", handleClick, true);
    window.removeEventListener("blur", handleBlur, true);
    clearAllPendingActions();

    if (state.windowLoadListener) {
      window.removeEventListener("load", state.windowLoadListener);
      state.windowLoadListener = null;
    }
    for (const timeoutId of state.warmUpTimeoutIds) window.clearTimeout(timeoutId);
    state.warmUpTimeoutIds = [];

    state.unsubNavDelta?.();
    state.unsubNavDelta = null;
    state.unsubRoots?.();
    state.unsubRoots = null;
    if (state.deleteSweepCancel) {
      state.deleteSweepCancel();
      state.deleteSweepCancel = null;
    }
    state.deleteSweepSchedule = null;
    if (state.hookScanCancel) {
      state.hookScanCancel();
      state.hookScanCancel = null;
    }
    state.hookScanSchedule = null;
    state.deleteSweepNav = null;
    for (const [conversationId] of state.sweepTimeoutsById) {
      clearSweepTimeouts(conversationId);
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
