import { SETTINGS_DEFAULTS, Settings } from "../domain/settings";

export function norm(value: string | null) {
  return String(value || "").toLowerCase();
}

export function isVisible(el: Element | null) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export function isElementVisible(el: Element | null) {
  if (!el || el.nodeType !== 1) return false;
  const r = el.getBoundingClientRect();
  if (r.width <= 1 || r.height <= 1) return false;
  const cs = getComputedStyle(el);
  if (cs.display === "none") return false;
  if (cs.visibility === "hidden") return false;
  if (cs.opacity === "0") return false;
  return true;
}

export function normalizeSettings(value: Record<string, unknown> | null | undefined): Settings {
  const base = SETTINGS_DEFAULTS;
  const data = value ?? {};
  const wideChatWidth =
    typeof data.wideChatWidth === "number" && Number.isFinite(data.wideChatWidth)
      ? Math.min(100, Math.max(0, Math.round(data.wideChatWidth)))
      : base.wideChatWidth;
  return {
    skipKey: typeof data.skipKey === "string" ? data.skipKey : base.skipKey,
    holdToSend: typeof data.holdToSend === "boolean" ? data.holdToSend : base.holdToSend,
    allowAutoSendInCodex:
      typeof data.allowAutoSendInCodex === "boolean"
        ? data.allowAutoSendInCodex
        : base.allowAutoSendInCodex,
    editLastMessageOnArrowUp:
      typeof data.editLastMessageOnArrowUp === "boolean"
        ? data.editLastMessageOnArrowUp
        : base.editLastMessageOnArrowUp,
    autoExpandChats:
      typeof data.autoExpandChats === "boolean" ? data.autoExpandChats : base.autoExpandChats,
    autoTempChat: typeof data.autoTempChat === "boolean" ? data.autoTempChat : base.autoTempChat,
    tempChatEnabled:
      typeof data.tempChatEnabled === "boolean" ? data.tempChatEnabled : base.tempChatEnabled,
    oneClickDelete:
      typeof data.oneClickDelete === "boolean" ? data.oneClickDelete : base.oneClickDelete,
    wideChatWidth
  };
}

export function isThenable<T>(value: void | Promise<T>): value is Promise<T> {
  return Boolean(value) && typeof (value as Promise<T>).then === "function";
}
