import { WIDE_CHAT_COLLISION_STYLE_TEXT } from "./wideChatOverlap";

export const WIDE_CHAT_FULL_WIDTH_PCT = 0.95;

export interface WideChatStyleInputs {
  basePx: number;
  wideChatWidth: number;
  windowWidth: number;
}

export const buildWideChatStyleText = ({
  basePx,
  wideChatWidth,
  windowWidth
}: WideChatStyleInputs): string | null => {
  if (wideChatWidth <= 0) return null;
  if (!Number.isFinite(basePx) || !Number.isFinite(windowWidth)) return null;
  const fullPx = Math.round(windowWidth * WIDE_CHAT_FULL_WIDTH_PCT);
  const sideMarginPx = Math.max(0, Math.round((windowWidth - fullPx) / 2));
  const targetPx = Math.round(basePx + (wideChatWidth / 100) * (fullPx - basePx));
  const maxAllowedPx = Math.max(320, fullPx);

  return `
    :root{
      --wide-chat-target-max-width: ${targetPx}px;
      --wide-chat-side-margin: ${sideMarginPx}px;
      --wide-chat-max-allowed: ${maxAllowedPx}px;
    }

    [class*="px-(--thread-content-margin)"]{
      --thread-content-margin: var(--wide-chat-side-margin) !important;
    }

    [class*="max-w-(--thread-content-max-width)"]{
      --thread-content-max-width: var(--wide-chat-target-max-width) !important;
      max-width: min(var(--wide-chat-target-max-width), var(--wide-chat-max-allowed)) !important;
    }

    ${WIDE_CHAT_COLLISION_STYLE_TEXT}
  `.trim();
};

export const updateWideChatStyle = (
  style: HTMLStyleElement,
  inputs: WideChatStyleInputs
): boolean => {
  const cssText = buildWideChatStyleText(inputs);
  if (!cssText) return false;
  if (style.textContent === cssText) return false;
  style.textContent = cssText;
  return true;
};
