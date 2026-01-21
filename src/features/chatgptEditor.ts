import { isDisabled } from "../lib/utils";

export type ComposerInput = HTMLTextAreaElement | HTMLElement;

const norm = (value: string | null | undefined) => (value || "").trim().toLowerCase();

const isMainComposer = (composer: ComposerInput) => {
  if (composer instanceof HTMLElement) {
    if (composer.id === "prompt-textarea") return true;
    if (composer.getAttribute("data-testid") === "prompt-textarea") return true;
  }
  return false;
};

export const findEditSubmitButton = (composer: ComposerInput): HTMLElement | null => {
  if (isMainComposer(composer)) return null;
  const closestForm = composer.closest("form");
  if (closestForm) {
    const submitBtn = closestForm.querySelector(
      'button[type="submit"], [role="button"][type="submit"]'
    );
    if (
      submitBtn instanceof HTMLElement &&
      !isDisabled(submitBtn) &&
      submitBtn.offsetParent !== null
    ) {
      return submitBtn;
    }
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

  const positive = [
    "save",
    "save and submit",
    "submit",
    "apply",
    "update",
    "done",
    "ok",
    "сохранить",
    "сохран",
    "применить",
    "готово"
  ];

  const negative = ["cancel", "close", "dismiss", "отмена", "отменить"];

  const candidates = buttons
    .filter((btn) => {
      if (isDisabled(btn)) return false;
      const aria = norm(btn.getAttribute("aria-label"));
      const title = norm(btn.getAttribute("title"));
      const dt = norm(btn.getAttribute("data-testid"));
      const txt = norm(btn.textContent);
      const hay = `${aria} ${title} ${dt} ${txt}`;
      if (negative.some((x) => hay.includes(x))) return false;
      return positive.some((x) => hay.includes(x));
    })
    .filter((btn) => btn.offsetParent !== null);

  if (candidates.length > 0) return candidates[0];

  const byTestId = buttons.find((btn) => {
    if (isDisabled(btn)) return false;
    const dt = norm(btn.getAttribute("data-testid"));
    if (!dt) return false;
    if (dt.includes("save")) return true;
    if (dt.includes("submit")) return true;
    if (dt.includes("apply")) return true;
    if (dt.includes("update")) return true;
    return false;
  });

  return byTestId ?? null;
};
