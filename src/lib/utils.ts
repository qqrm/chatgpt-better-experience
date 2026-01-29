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

export function isDisabled(el: HTMLElement | null) {
  if (!el) return true;
  if (el instanceof HTMLButtonElement && el.disabled) return true;
  if (el.hasAttribute("disabled")) return true;
  const ariaDisabled = el.getAttribute("aria-disabled");
  if (ariaDisabled && ariaDisabled !== "false") return true;
  return false;
}

export function normalizeSettings(data: Record<string, unknown>): Settings {
  const base = SETTINGS_DEFAULTS;

  const legacySkipKey =
    typeof (data as { skipKey?: unknown }).skipKey === "string"
      ? ((data as { skipKey?: unknown }).skipKey as string)
      : null;

  const legacyHoldToSend =
    typeof (data as { holdToSend?: unknown }).holdToSend === "boolean"
      ? ((data as { holdToSend?: unknown }).holdToSend as boolean)
      : null;
  void legacyHoldToSend;

  const autoSend =
    typeof (data as { autoSend?: unknown }).autoSend === "boolean"
      ? ((data as { autoSend?: unknown }).autoSend as boolean)
      : legacySkipKey === "None"
        ? false
        : true;

  return {
    autoSend,
    allowAutoSendInCodex:
      typeof (data as { allowAutoSendInCodex?: unknown }).allowAutoSendInCodex === "boolean"
        ? ((data as { allowAutoSendInCodex?: unknown }).allowAutoSendInCodex as boolean)
        : base.allowAutoSendInCodex,

    editLastMessageOnArrowUp:
      typeof (data as { editLastMessageOnArrowUp?: unknown }).editLastMessageOnArrowUp === "boolean"
        ? ((data as { editLastMessageOnArrowUp?: unknown }).editLastMessageOnArrowUp as boolean)
        : base.editLastMessageOnArrowUp,

    autoExpandChats:
      typeof (data as { autoExpandChats?: unknown }).autoExpandChats === "boolean"
        ? ((data as { autoExpandChats?: unknown }).autoExpandChats as boolean)
        : base.autoExpandChats,

    autoExpandProjects:
      typeof (data as { autoExpandProjects?: unknown }).autoExpandProjects === "boolean"
        ? ((data as { autoExpandProjects?: unknown }).autoExpandProjects as boolean)
        : base.autoExpandProjects,

    autoTempChat:
      typeof (data as { autoTempChat?: unknown }).autoTempChat === "boolean"
        ? ((data as { autoTempChat?: unknown }).autoTempChat as boolean)
        : base.autoTempChat,

    tempChatEnabled:
      typeof (data as { tempChatEnabled?: unknown }).tempChatEnabled === "boolean"
        ? ((data as { tempChatEnabled?: unknown }).tempChatEnabled as boolean)
        : base.tempChatEnabled,

    oneClickDelete:
      typeof (data as { oneClickDelete?: unknown }).oneClickDelete === "boolean"
        ? ((data as { oneClickDelete?: unknown }).oneClickDelete as boolean)
        : base.oneClickDelete,

    startDictation:
      typeof (data as { startDictation?: unknown }).startDictation === "boolean"
        ? ((data as { startDictation?: unknown }).startDictation as boolean)
        : base.startDictation,

    ctrlEnterSends:
      typeof (data as { ctrlEnterSends?: unknown }).ctrlEnterSends === "boolean"
        ? ((data as { ctrlEnterSends?: unknown }).ctrlEnterSends as boolean)
        : base.ctrlEnterSends,

    wideChatWidth: (() => {
      const rawWidth = (data as { wideChatWidth?: unknown }).wideChatWidth;
      if (typeof rawWidth !== "number" || !Number.isFinite(rawWidth)) {
        return base.wideChatWidth;
      }
      return Math.min(100, Math.max(0, rawWidth));
    })()
  };
}

export function isThenable<T>(value: void | Promise<T>): value is Promise<T> {
  return Boolean(value) && typeof (value as Promise<T>).then === "function";
}
