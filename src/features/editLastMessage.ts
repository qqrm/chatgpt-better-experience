import { shouldTriggerArrowUpEdit } from "../application/editLastMessageUseCases";
import { FeatureContext, FeatureHandle } from "../application/featureContext";
import { DictationInputKind } from "../domain/dictation";
import { isElementVisible, norm } from "../lib/utils";

interface InputReadResult {
  ok: boolean;
  kind: DictationInputKind;
  text: string;
}

export function initEditLastMessageFeature(ctx: FeatureContext): FeatureHandle {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const qs = <T extends Element = Element>(sel: string, root: Document | Element = document) =>
    root.querySelector<T>(sel);
  const qsa = <T extends Element = Element>(sel: string, root: Document | Element = document) =>
    Array.from(root.querySelectorAll<T>(sel));

  const isEditableElement = (el: Element | null) => {
    if (!el) return false;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return true;
    if (el.getAttribute("contenteditable") === "true") return true;
    return !!el.closest('[contenteditable="true"]');
  };

  const findVisibleInput = (root: Element | Document) => {
    const candidates = qsa<HTMLInputElement | HTMLTextAreaElement>("input, textarea", root);
    for (const el of candidates) {
      if (el instanceof HTMLInputElement && el.type === "hidden") continue;
      if (isElementVisible(el)) return el;
    }
    return null;
  };

  const findRenameMenuItem = (menu: Element) => {
    const preferred = menu.querySelector<HTMLElement>(
      'div[role="menuitem"][data-testid="rename-chat-menu-item"]'
    );
    if (preferred) return preferred;
    const items = qsa<HTMLElement>('[role="menuitem"]', menu);
    for (const item of items) {
      const text = norm(item.textContent);
      if (text.includes("rename") || text.includes("переимен")) return item;
    }
    return null;
  };

  const waitForVisibleRadixMenu = async (timeoutMs = 2000) => {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      const menus = qsa('[data-radix-menu-content][role="menu"]');
      for (const menu of menus) {
        if (isElementVisible(menu)) return menu;
      }
      await sleep(25);
    }
    return null;
  };

  const waitForRenameInput = async (activeChat: HTMLElement, timeoutMs = 2000) => {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      const inChat = findVisibleInput(activeChat);
      if (inChat) return inChat;
      const dialogs = qsa<HTMLElement>('[role="dialog"]');
      const dialog = dialogs.find((el) => isElementVisible(el)) ?? null;
      if (dialog) {
        const dialogInput = findVisibleInput(dialog);
        if (dialogInput) return dialogInput;
      }
      await sleep(25);
    }
    return null;
  };

  const logRenameStep = (step: string, ok: boolean) => {
    ctx.logger.debug("KEY", "rename chat", { step, ok });
  };

  const findActiveChat = () => {
    const selectors = [
      'a[data-sidebar-item="true"][data-active]',
      'a[data-sidebar-item="true"][aria-current="page"]',
      "a[data-active]",
      'nav[aria-label="Chat history"] a[aria-current="page"]'
    ];
    for (const selector of selectors) {
      const el = qs<HTMLElement>(selector);
      if (el) return el;
    }
    return null;
  };

  const findOptionsButton = (activeChat: HTMLElement) => {
    const optionsSelector = 'button[data-testid^="history-item-"][data-testid$="-options"]';
    return (
      activeChat.querySelector<HTMLButtonElement>(optionsSelector) ??
      activeChat.parentElement?.querySelector<HTMLButtonElement>(optionsSelector) ??
      activeChat.closest("li, div")?.querySelector<HTMLButtonElement>(optionsSelector) ??
      null
    );
  };

  const triggerRenameActiveChat = async (activeChatOverride?: HTMLElement) => {
    const activeChat = activeChatOverride ?? findActiveChat();
    if (!activeChat) {
      logRenameStep("activeChat not found", false);
      return false;
    }
    const optionsBtn = findOptionsButton(activeChat);
    if (!optionsBtn) {
      logRenameStep("optionsBtn not found", false);
      return false;
    }
    ctx.helpers.humanClick(optionsBtn, "open chat options");

    const menu = await waitForVisibleRadixMenu(2000);
    if (!menu) {
      logRenameStep("menu not found", false);
      return false;
    }

    const renameItem = findRenameMenuItem(menu);
    if (!renameItem) {
      logRenameStep("renameItem not found", false);
      return false;
    }
    ctx.helpers.humanClick(renameItem, "rename chat");

    const input = await waitForRenameInput(activeChat, 2000);
    if (!input) {
      logRenameStep("input not found", false);
      return false;
    }
    try {
      input.focus();
      if (typeof input.select === "function") input.select();
    } catch (_) {}
    logRenameStep("ok", true);
    return true;
  };

  const findTextbox = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      const ce = active.getAttribute("contenteditable");
      if (ce === "true") return active;
    }

    const byId = document.getElementById("prompt-textarea");
    if (byId instanceof HTMLElement && byId.getAttribute("contenteditable") === "true") {
      return byId;
    }

    const byTestId = document.querySelector('[data-testid="prompt-textarea"]');
    if (byTestId instanceof HTMLElement) return byTestId;

    const textarea = document.querySelector("textarea");
    if (textarea instanceof HTMLTextAreaElement) return textarea;

    const anyCe = document.querySelector('[contenteditable="true"]');
    if (anyCe instanceof HTMLElement) return anyCe;

    return null;
  };

  const readTextboxText = (el: HTMLTextAreaElement | HTMLElement | null) => {
    if (!el) return "";
    if (el instanceof HTMLTextAreaElement) return el.value || "";
    return String(el.innerText || el.textContent || "").replace(/\u00A0/g, " ");
  };

  const readInputText = (): InputReadResult => {
    const el = findTextbox();
    if (!el) return { ok: false, kind: "none", text: "" };
    const kind: DictationInputKind =
      el instanceof HTMLTextAreaElement ? "textarea" : "contenteditable";
    return { ok: true, kind, text: readTextboxText(el) };
  };

  const isTextboxTarget = (target: EventTarget | null) => {
    if (!(target instanceof Node)) return false;
    const textbox = findTextbox();
    if (!textbox) return false;
    return target === textbox || textbox.contains(target);
  };

  const findLastUserMessage = () => {
    const candidates = qsa<HTMLElement>('[data-message-author-role="user"]');
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const msg = candidates[i];
      if (isElementVisible(msg)) return msg;
    }
    return null;
  };

  const isEditMessageButton = (btn: HTMLElement | null) => {
    if (!btn) return false;
    const a = norm(btn.getAttribute("aria-label"));
    const t = norm(btn.getAttribute("title"));
    const dt = norm(btn.getAttribute("data-testid"));
    const txt = norm(btn.textContent);
    if (dt.includes("edit")) return true;
    if (a.includes("edit") || a.includes("редакт") || a.includes("измен")) return true;
    if (t.includes("edit") || t.includes("редакт") || t.includes("измен")) return true;
    if (txt.includes("edit") || txt.includes("редакт") || txt.includes("измен")) return true;
    return false;
  };

  const findEditInput = (root: Element) => {
    const textarea = root.querySelector("textarea");
    if (textarea instanceof HTMLTextAreaElement && isElementVisible(textarea)) {
      return textarea;
    }

    const contentEditable = root.querySelector('[contenteditable="true"]');
    if (contentEditable instanceof HTMLElement && isElementVisible(contentEditable)) {
      return contentEditable;
    }

    return null;
  };

  const placeCursorAtEnd = (input: HTMLElement | HTMLTextAreaElement) => {
    if (input instanceof HTMLTextAreaElement) {
      const end = input.value.length;
      input.selectionStart = end;
      input.selectionEnd = end;
      return;
    }

    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(input);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const waitForEditInput = async (message: HTMLElement, timeoutMs = 2000) => {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      const input = findEditInput(message);
      if (input) return input;
      await sleep(50);
    }
    return null;
  };

  const triggerEditLastMessage = async () => {
    const message = findLastUserMessage();
    if (!message) return false;

    const article =
      message.closest("article") ??
      message.closest("[data-message-author-role]") ??
      message.parentElement;

    const searchRoot = article instanceof HTMLElement ? article : message;

    const buttons = qsa<HTMLElement>("button, [role='button']", searchRoot);

    const editBtn =
      buttons.find((btn) => {
        const a = norm(btn.getAttribute("aria-label"));
        if (a.includes("edit message")) return true;
        return isEditMessageButton(btn);
      }) ?? null;

    if (!editBtn) return false;

    message.scrollIntoView({ block: "center", inline: "nearest" });
    const clickOk = ctx.helpers.humanClick(editBtn, "edit last message");
    if (!clickOk) return false;

    const input = await waitForEditInput(searchRoot, 2000);
    if (!input) return false;

    input.focus();
    placeCursorAtEnd(input);
    message.scrollIntoView({ block: "center" });
    return true;
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "F2" && !e.repeat) {
      const targetEl = e.target instanceof Element ? e.target : null;
      const activeEl = document.activeElement instanceof Element ? document.activeElement : null;
      if (!isEditableElement(targetEl) && !isEditableElement(activeEl)) {
        const activeChat = findActiveChat();
        if (activeChat) {
          e.preventDefault();
          e.stopPropagation();
          void (async () => {
            await triggerRenameActiveChat(activeChat);
          })();
          return;
        }
      }
    }

    if (
      shouldTriggerArrowUpEdit({
        enabled: ctx.settings.editLastMessageOnArrowUp,
        key: e.key,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        isComposing: e.isComposing,
        inputText: readInputText().text
      }) &&
      isTextboxTarget(e.target)
    ) {
      void (async () => {
        const ok = await triggerEditLastMessage();
        ctx.logger.debug("KEY", "arrow up edit last message", { ok });
        if (ok) {
          e.preventDefault();
          e.stopPropagation();
        }
      })();
    }
  };

  window.addEventListener("keydown", handleKeyDown, true);

  return {
    name: "editLastMessage",
    dispose: () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    },
    getStatus: () => ({ active: ctx.settings.editLastMessageOnArrowUp })
  };
}
