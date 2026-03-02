import { isDisabled, isElementVisible } from "../lib/utils";

export type ComposerInput = HTMLTextAreaElement | HTMLElement;

const norm = (value: string | null | undefined) => (value || "").trim().toLowerCase();

const isVisible = (el: HTMLElement) => isElementVisible(el);

const MAIN_COMPOSER_MARKERS = [
  "#thread-bottom",
  "#thread-bottom-container",
  ".composer-parent",
  "footer",
  '[data-testid*="composer" i]',
  '[data-testid*="conversation-composer" i]'
];

const isMainComposer = (composer: ComposerInput) => {
  if (!(composer instanceof HTMLElement)) return false;

  const id = composer.id;
  const testId = composer.getAttribute("data-testid");
  const looksLikePrompt = id === "prompt-textarea" || testId === "prompt-textarea";
  if (!looksLikePrompt) return false;

  for (const marker of MAIN_COMPOSER_MARKERS) {
    try {
      if (composer.closest(marker)) return true;
    } catch {
      // ignore invalid selectors in older UI variants
    }
  }

  return false;
};

const getHay = (btn: HTMLElement) => {
  const aria = norm(btn.getAttribute("aria-label"));
  const title = norm(btn.getAttribute("title"));
  const dt = norm(btn.getAttribute("data-testid"));
  const txt = norm(btn.textContent);
  return `${aria} ${title} ${dt} ${txt}`.trim();
};

const POSITIVE = [
  "save",
  "save and submit",
  "submit",
  "apply",
  "update",
  "done",
  "ok",
  "send",
  "send message",
  "сохранить",
  "сохран",
  "применить",
  "готово",
  "ок",
  "отправить",
  "отправ"
];

const NEGATIVE = ["cancel", "close", "dismiss", "отмена", "отменить"];

const isPositiveAction = (btn: HTMLElement) => {
  if (isDisabled(btn)) return false;
  if (!isVisible(btn)) return false;
  const hay = getHay(btn);
  if (!hay) return false;
  if (NEGATIVE.some((x) => hay.includes(x))) return false;
  return POSITIVE.some((x) => hay.includes(x));
};

export const findEditSubmitButton = (composer: ComposerInput): HTMLElement | null => {
  if (isMainComposer(composer)) return null;

  const closestForm = composer.closest("form");
  if (closestForm) {
    const submitBtn = closestForm.querySelector(
      'button[type="submit"], [role="button"][type="submit"]'
    );
    if (submitBtn instanceof HTMLElement && !isDisabled(submitBtn) && isVisible(submitBtn)) {
      return submitBtn;
    }

    // ChatGPT edit UI frequently uses a plain <button> "Send" without type=submit.
    const formButtons = Array.from(closestForm.querySelectorAll("button, [role='button']")).filter(
      (btn): btn is HTMLElement => btn instanceof HTMLElement
    );
    const byText = formButtons.find((btn) => isPositiveAction(btn));
    if (byText) return byText;
  }

  const searchRoots: Array<Element | null> = [
    composer.closest('[role="dialog"], [role="alertdialog"]'),
    composer.closest("article"),
    composer.closest("[data-message-author-role]"),
    composer.closest('[data-testid*="message" i]'),
    composer.closest("div")
  ];

  const root = searchRoots.find((x): x is Element => !!x) ?? null;
  if (!root) return null;

  const buttons = Array.from(root.querySelectorAll("button, [role='button']")).filter(
    (btn): btn is HTMLElement => btn instanceof HTMLElement
  );

  const candidates = buttons.filter((btn) => isPositiveAction(btn));
  if (candidates.length > 0) return candidates[0];

  const byTestId = buttons.find((btn) => {
    if (isDisabled(btn)) return false;
    if (!isVisible(btn)) return false;
    const dt = norm(btn.getAttribute("data-testid"));
    if (!dt) return false;
    if (dt.includes("save")) return true;
    if (dt.includes("submit")) return true;
    if (dt.includes("apply")) return true;
    if (dt.includes("update")) return true;
    if (dt.includes("send")) return true;
    return false;
  });

  return byTestId ?? null;
};

const findVisibleComposerInputs = (root: ParentNode): ComposerInput[] => {
  const out: ComposerInput[] = [];

  const push = (el: Element) => {
    if (!(el instanceof HTMLElement)) return;
    if (!isVisible(el)) return;
    if (el instanceof HTMLTextAreaElement) out.push(el);
    else if (el.getAttribute("contenteditable") === "true") out.push(el);
  };

  const textareas = Array.from(root.querySelectorAll("textarea"));
  for (const el of textareas) push(el);

  const ces = Array.from(root.querySelectorAll('[contenteditable="true"]'));
  for (const el of ces) push(el);

  return out;
};

export const findAnyEditSubmitButton = (): HTMLElement | null => {
  const active = document.activeElement;

  const candidateRoots: Element[] = [];

  const userMsgs = Array.from(
    document.querySelectorAll<HTMLElement>("[data-message-author-role='user']")
  );
  for (let i = userMsgs.length - 1; i >= 0; i -= 1) {
    const msg = userMsgs[i];
    const scope = (msg.closest("article") ?? msg) as Element;
    if (scope && !candidateRoots.includes(scope)) candidateRoots.push(scope);
  }

  const dialogs = Array.from(
    document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')
  );
  for (const dialog of dialogs) {
    if (!isVisible(dialog)) continue;
    candidateRoots.push(dialog);
  }

  const rootsOrdered = (() => {
    if (!(active instanceof HTMLElement)) return candidateRoots;
    const activeRoot = candidateRoots.find((root) => root.contains(active)) ?? null;
    if (!activeRoot) return candidateRoots;
    return [activeRoot, ...candidateRoots.filter((root) => root !== activeRoot)];
  })();

  for (const root of rootsOrdered) {
    const inputs = findVisibleComposerInputs(root);
    for (const input of inputs) {
      if (isMainComposer(input)) continue;
      const button = findEditSubmitButton(input);
      if (button) return button;
    }
  }

  return null;
};
