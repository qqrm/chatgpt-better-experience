export const WIDE_CHAT_OVERLAP_TURN_ATTR = "data-qqrm-wide-chat-overlap";
export const WIDE_CHAT_OVERLAP_TURN_CLASS = "qqrm-wide-chat-turn-overlap";
export const WIDE_CHAT_CONTENT_CLASS = "qqrm-wide-chat-content-pad";
export const WIDE_CHAT_SHELF_CLASS = "qqrm-wide-chat-shelf";
export const WIDE_CHAT_CONTENT_PAD_TOP_VAR = "--qqrm-wide-chat-pad-top";
export const WIDE_CHAT_CONTENT_PAD_RIGHT_VAR = "--qqrm-wide-chat-pad-right";
export const WIDE_CHAT_SHELF_BG_VAR = "--qqrm-wide-chat-shelf-bg";

const FALLBACK_SHELF_BG = "rgba(32, 33, 35, 0.96)";
const CONTENT_SELECTOR = ".markdown, [data-message-content], .whitespace-pre-wrap, .prose";
const INTERACTIVE_SELECTOR = 'button, [role="button"], a[href]';
const HOST_SELECTOR = '[class*="justify-between"], [class*="items-center"], [class*="gap-"]';

export const WIDE_CHAT_COLLISION_STYLE_TEXT = `
  article.${WIDE_CHAT_OVERLAP_TURN_CLASS}[${WIDE_CHAT_OVERLAP_TURN_ATTR}="1"] .${WIDE_CHAT_CONTENT_CLASS}{
    box-sizing:border-box;
    padding-top:var(${WIDE_CHAT_CONTENT_PAD_TOP_VAR}, 0px) !important;
    padding-inline-end:var(${WIDE_CHAT_CONTENT_PAD_RIGHT_VAR}, 0px) !important;
  }

  article.${WIDE_CHAT_OVERLAP_TURN_CLASS}[${WIDE_CHAT_OVERLAP_TURN_ATTR}="1"] .${WIDE_CHAT_SHELF_CLASS}{
    position:relative;
    z-index:1;
    background:var(${WIDE_CHAT_SHELF_BG_VAR}, ${FALLBACK_SHELF_BG}) !important;
    border-radius:12px;
    padding:4px 10px;
  }
`.trim();

export interface WideChatOverlapMatch {
  turn: HTMLElement;
  content: HTMLElement;
  shelfHosts: HTMLElement[];
  topPadPx: number;
  rightPadPx: number;
  shelfBg: string;
}

const hasVisibleRect = (rect: DOMRect) => rect.width > 1 && rect.height > 1;

const intersects = (a: DOMRect, b: DOMRect) =>
  Math.min(a.right, b.right) > Math.max(a.left, b.left) &&
  Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);

const clampPad = (value: number) => Math.max(0, Math.min(240, Math.ceil(value)));

const isTransparent = (value: string) => {
  const normalized = value.trim().toLowerCase();
  return (
    !normalized ||
    normalized === "transparent" ||
    normalized === "rgba(0, 0, 0, 0)" ||
    normalized === "rgba(0,0,0,0)"
  );
};

export const resolveOpaqueSurfaceColor = (start: HTMLElement | null): string => {
  let current: HTMLElement | null = start;
  while (current) {
    const bg = window.getComputedStyle(current).backgroundColor;
    if (!isTransparent(bg)) return bg;
    current = current.parentElement;
  }

  const bodyBg = window.getComputedStyle(document.body).backgroundColor;
  if (!isTransparent(bodyBg)) return bodyBg;

  const rootBg = window.getComputedStyle(document.documentElement).backgroundColor;
  if (!isTransparent(rootBg)) return rootBg;

  return FALLBACK_SHELF_BG;
};

const isWithinBoundary = (
  boundary: HTMLElement,
  candidate: HTMLElement | null
): candidate is HTMLElement =>
  !!candidate && (candidate === boundary || boundary.contains(candidate));

const selectContentEl = (turn: HTMLElement, assistantMessage: HTMLElement): HTMLElement | null =>
  assistantMessage.querySelector<HTMLElement>(CONTENT_SELECTOR) ??
  turn.querySelector<HTMLElement>(CONTENT_SELECTOR) ??
  null;

const findShelfHost = (candidate: HTMLElement, boundary: HTMLElement): HTMLElement => {
  const host = candidate.closest<HTMLElement>(HOST_SELECTOR);
  if (isWithinBoundary(boundary, host)) {
    const hostRect = host.getBoundingClientRect();
    if (hasVisibleRect(hostRect) && hostRect.height <= 96) return host;
  }

  let current: HTMLElement | null = candidate;
  while (current && current !== boundary) {
    const rect = current.getBoundingClientRect();
    if (hasVisibleRect(rect) && rect.height <= 96) return current;
    current = current.parentElement;
  }

  return candidate;
};

const isUsefulCandidate = (candidate: HTMLElement) => {
  if (!candidate.isConnected) return false;
  if ((candidate.textContent ?? "").trim().length > 0) return true;
  return candidate.querySelector("svg, img") !== null;
};

export function detectWideChatOverlaps(root: ParentNode = document): WideChatOverlapMatch[] {
  const assistantMessages = Array.from(
    root.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"]')
  );
  const matches: WideChatOverlapMatch[] = [];
  const handledTurns = new Set<HTMLElement>();

  for (const assistantMessage of assistantMessages) {
    const turn = assistantMessage.closest<HTMLElement>("article");
    if (!turn || handledTurns.has(turn)) continue;
    handledTurns.add(turn);

    const content = selectContentEl(turn, assistantMessage);
    if (!content) continue;

    const contentRect = content.getBoundingClientRect();
    if (!hasVisibleRect(contentRect)) continue;

    const shelfHosts: HTMLElement[] = [];
    const seenHosts = new Set<HTMLElement>();
    let topPadPx = 0;
    let rightPadPx = 0;

    for (const candidate of Array.from(turn.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR))) {
      if (!isUsefulCandidate(candidate)) continue;

      const shelfHost = findShelfHost(candidate, turn);
      if (seenHosts.has(shelfHost)) continue;
      seenHosts.add(shelfHost);

      const shelfRect = shelfHost.getBoundingClientRect();
      if (!hasVisibleRect(shelfRect) || !intersects(shelfRect, contentRect)) continue;

      shelfHosts.push(shelfHost);

      const overlapsTopBand =
        shelfRect.top <= contentRect.top + Math.min(120, contentRect.height * 0.35);
      if (overlapsTopBand) {
        topPadPx = Math.max(topPadPx, clampPad(shelfRect.bottom - contentRect.top + 8));
      }

      const isRightAligned =
        shelfRect.left >= contentRect.left + contentRect.width * 0.4 &&
        shelfRect.width < contentRect.width * 0.75;
      if (isRightAligned) {
        rightPadPx = Math.max(rightPadPx, clampPad(contentRect.right - shelfRect.left + 12));
      }
    }

    if (shelfHosts.length === 0) continue;

    matches.push({
      turn,
      content,
      shelfHosts,
      topPadPx,
      rightPadPx,
      shelfBg: resolveOpaqueSurfaceColor(shelfHosts[0] ?? turn)
    });
  }

  return matches;
}
