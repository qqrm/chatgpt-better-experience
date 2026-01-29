import { isDisabled } from "../lib/utils";

export type ComposerInput = HTMLTextAreaElement | HTMLElement;

const norm = (value: string | null | undefined) => (value || "").trim().toLowerCase();

const isVisible = (el: HTMLElement) => el.offsetParent !== null;

const isMainComposer = (composer: ComposerInput) => {
  if (composer instanceof HTMLElement) {
    if (composer.id === "prompt-textarea") return true;
    if (composer.getAttribute("data-testid") === "prompt-textarea") return true;
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
