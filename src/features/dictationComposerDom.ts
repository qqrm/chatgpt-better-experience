import type { DictationInputKind } from "../domain/dictation";

export interface InputReadResult {
  ok: boolean;
  kind: DictationInputKind;
  text: string;
}

export function createComposerDom(document: Document = globalThis.document) {
  const qs = <T extends Element = Element>(sel: string) => document.querySelector<T>(sel);
  const findComposerRoot = (): Element | null => {
    const footer = document.querySelector('[data-testid="composer-footer-actions"]');
    if (footer)
      return footer.closest("form") ?? footer.closest('[data-testid="composer"]') ?? footer;

    const byId = document.getElementById("prompt-textarea");
    if (byId) return byId.closest("form") ?? byId.closest('[data-testid="composer"]');

    const explicitComposer =
      document.querySelector('form[data-testid="composer"]') ??
      document.querySelector('[data-testid="composer"]') ??
      Array.from(document.querySelectorAll("form")).find((form) =>
        form.classList.contains("group/composer")
      ) ??
      null;
    if (explicitComposer) return explicitComposer;

    return (
      Array.from(document.querySelectorAll("form")).find(
        (form) =>
          !!form.querySelector(
            "#prompt-textarea, [name='prompt-textarea'], [aria-label='Start dictation']"
          )
      ) ?? null
    );
  };

  const findTextbox = () => {
    // Prefer the composer input, not arbitrary focused contenteditable elsewhere on the page.
    // ChatGPT can have other contenteditables (edit message, etc.) that would break AutoSend.
    const primary = findComposerInput();
    if (primary) return primary;

    const root = findComposerRoot();
    const active = document.activeElement;
    if (root && active instanceof HTMLElement) {
      const ce = active.getAttribute("contenteditable");
      if (ce === "true" && root.contains(active)) return active;
    }

    if (root) {
      const anyCe = root.querySelector('[contenteditable="true"]');
      if (anyCe instanceof HTMLElement) return anyCe;
      const textarea = root.querySelector("textarea");
      if (textarea instanceof HTMLTextAreaElement) return textarea;
    }

    return null;
  };

  const findComposerInput = () => {
    const byId = document.getElementById("prompt-textarea");
    if (byId instanceof HTMLTextAreaElement) return byId;
    if (byId instanceof HTMLElement && byId.getAttribute("contenteditable") === "true") {
      return byId;
    }

    const byTestId = document.querySelector('[data-testid="prompt-textarea"]');
    if (byTestId instanceof HTMLTextAreaElement) return byTestId;
    if (byTestId instanceof HTMLElement && byTestId.getAttribute("contenteditable") === "true") {
      return byTestId;
    }

    const textarea = document.querySelector("textarea");
    if (textarea instanceof HTMLTextAreaElement) return textarea;

    return null;
  };

  const hasDictationMarker = (value: string) =>
    /dictat|dictation|microphone|\bmic\b|voice|speech|record|диктов|микроф|голос|надикт|запис/.test(
      value
    );

  const readTextboxText = (el: HTMLTextAreaElement | HTMLElement | null) => {
    if (!el) return "";
    if (el instanceof HTMLTextAreaElement) return el.value || "";
    const tc = String(el.textContent || "");
    const it = String((el as HTMLElement).innerText || "");
    return String(tc.trim().length ? tc : it).replace(/\u00A0/g, " ");
  };

  const readInputText = (): InputReadResult => {
    const el = findTextbox();
    if (!el) return { ok: false, kind: "none", text: "" };
    const kind: DictationInputKind =
      el instanceof HTMLTextAreaElement ? "textarea" : "contenteditable";
    return { ok: true, kind, text: readTextboxText(el) };
  };

  const findSendButton = (): HTMLElement | null =>
    qs<HTMLElement>('[data-testid="send-button"]') ||
    qs<HTMLElement>("#composer-submit-button") ||
    qs<HTMLElement>("button.composer-submit-btn") ||
    qs<HTMLElement>("form button[type='submit']") ||
    qs<HTMLElement>('button[aria-label*="Send"]') ||
    qs<HTMLElement>('[role="button"][aria-label*="Send"]') ||
    qs<HTMLElement>('button[aria-label*="Отправ"]') ||
    null;

  return {
    findComposerRoot,
    findTextbox,
    findComposerInput,
    hasDictationMarker,
    readTextboxText,
    readInputText,
    findSendButton
  };
}
