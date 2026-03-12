import { isDisabled, isElementVisible } from "../lib/utils";
import type { ComposerInput } from "./chatgptEditor";

const MAIN_ROOT_SELECTORS = ['main[role="main"]', "main", '[role="main"]'];
const PROMPT_SELECTORS = [
  'textarea[data-testid="prompt-textarea"]',
  '[contenteditable="true"][data-testid="prompt-textarea"]',
  "#prompt-textarea",
  "form textarea",
  'form [contenteditable="true"]',
  "footer textarea"
];
const SEND_BUTTON_SELECTORS = [
  "#composer-submit-button",
  "button.composer-submit-btn",
  '[data-testid="send-button"]',
  '[data-testid="composer-submit-button"]',
  'button[type="submit"]',
  'button[aria-label*="Send" i]',
  '[role="button"][aria-label*="Send" i]',
  'button[aria-label="Submit"]',
  '[role="button"][aria-label="Submit"]',
  'button[aria-label*="Отправ" i]',
  '[role="button"][aria-label*="Отправ" i]'
];

const isVisible = (el: HTMLElement) => isElementVisible(el);

export function readConversationId(pathname = location.pathname): string | null {
  const match = pathname.match(/\/c\/([^/?#]+)/);
  return match?.[1] ?? null;
}

export function readConversationIdFromHref(href: string | null | undefined): string | null {
  if (!href) return null;

  try {
    return readConversationId(new URL(href, location.origin).pathname);
  } catch {
    const match = href.match(/\/c\/([^/?#]+)/);
    return match?.[1] ?? null;
  }
}

export function readCurrentConversationId(
  root: ParentNode = document,
  pathname = location.pathname
): string | null {
  const fromPath = readConversationId(pathname);
  if (fromPath) return fromPath;

  const canonical = root.querySelector<HTMLLinkElement>('link[rel="canonical"][href]');
  const canonicalId = readConversationIdFromHref(canonical?.href);
  if (canonicalId) return canonicalId;

  const currentNavLink = root.querySelector<HTMLAnchorElement>(
    'a[aria-current="page"][href*="/c/"]'
  );
  const currentNavId = readConversationIdFromHref(currentNavLink?.href);
  if (currentNavId) return currentNavId;

  const candidateIds = new Set<string>();
  for (const element of Array.from(
    root.querySelectorAll<HTMLAnchorElement | HTMLLinkElement>(
      'link[rel="alternate"][href*="/c/"], a[href*="/c/"]'
    )
  )) {
    const conversationId = readConversationIdFromHref(element.getAttribute("href"));
    if (conversationId) candidateIds.add(conversationId);
    if (candidateIds.size > 1) break;
  }

  if (candidateIds.size === 1) {
    const [conversationId] = candidateIds;
    return conversationId ?? null;
  }

  return null;
}

function normalizeConversationPath(pathname: string): string {
  const trimmed = pathname.trim();
  if (!trimmed) return "/";

  const withoutTrailingSlash = trimmed.replace(/\/+$/, "");
  return withoutTrailingSlash || "/";
}

export function readConversationStorageKey(
  pathname = location.pathname,
  root: ParentNode = document
): string {
  const conversationId = readCurrentConversationId(root, pathname);
  if (conversationId) return conversationId;
  return `path:${normalizeConversationPath(pathname)}`;
}

export function findMainRoot(root: ParentNode = document): HTMLElement | null {
  for (const selector of MAIN_ROOT_SELECTORS) {
    const el = root.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  return null;
}

export function findConversationScrollRoot(root: ParentNode = document): HTMLElement | null {
  const main = findMainRoot(root);
  const scrollRoot =
    main?.querySelector<HTMLElement>("[data-scroll-root]") ??
    document.querySelector<HTMLElement>("[data-scroll-root]");
  return scrollRoot ?? main;
}

export function findMainComposerInput(root: ParentNode = document): ComposerInput | null {
  for (const selector of PROMPT_SELECTORS) {
    const el = root.querySelector(selector);
    if (el instanceof HTMLTextAreaElement) return el;
    if (el instanceof HTMLElement && el.getAttribute("contenteditable") === "true") return el;
  }
  return null;
}

export function findMainComposerForm(root: ParentNode = document): HTMLFormElement | null {
  const input = findMainComposerInput(root);
  const form = input?.closest("form");
  if (form) return form;

  const byTestId = document.querySelector<HTMLFormElement>('form[data-testid="composer"]');
  if (byTestId) return byTestId;

  const fallbackForm = document.querySelector<HTMLFormElement>("form");
  if (
    fallbackForm &&
    (fallbackForm.querySelector('[data-testid="prompt-textarea"]') ||
      fallbackForm.querySelector("textarea, [contenteditable='true']"))
  ) {
    return fallbackForm;
  }

  return null;
}

export function findMainSendButton(root: ParentNode = document): HTMLElement | null {
  const form = findMainComposerForm(root);

  const tryFindIn = (scope: ParentNode): HTMLElement | null => {
    for (const selector of SEND_BUTTON_SELECTORS) {
      const el = scope.querySelector(selector);
      if (!(el instanceof HTMLElement)) continue;
      if (!isVisible(el)) continue;
      if (isDisabled(el)) continue;
      return el;
    }
    return null;
  };

  if (form) {
    const inside = tryFindIn(form);
    if (inside) return inside;
  }

  return tryFindIn(document);
}

export function isEventInsideMainComposer(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const form = findMainComposerForm();
  if (form?.contains(target)) return true;

  const input = findMainComposerInput();
  if (!input) return false;
  return input === target || (input instanceof HTMLElement && input.contains(target));
}

export function getMessageRole(messageEl: HTMLElement | null): "user" | "assistant" | null {
  const role = messageEl?.getAttribute("data-message-author-role");
  return role === "user" || role === "assistant" ? role : null;
}

export function findMessageTurn(messageEl: HTMLElement | null): HTMLElement | null {
  return messageEl?.closest<HTMLElement>("article") ?? null;
}

export function findUserMessageBubble(messageEl: HTMLElement): HTMLElement | null {
  return (
    messageEl.querySelector<HTMLElement>(".user-message-bubble-color") ??
    messageEl.querySelector<HTMLElement>('[class*="user-message-bubble"]')
  );
}

export function collectMessageElementsFromNode(node: Node): HTMLElement[] {
  if (!(node instanceof Element)) return [];

  const out = new Set<HTMLElement>();
  const directMessage =
    node instanceof HTMLElement &&
    node.hasAttribute("data-message-id") &&
    node.hasAttribute("data-message-author-role")
      ? node
      : null;
  if (directMessage) out.add(directMessage);

  const ancestorMessage = node.closest<HTMLElement>("[data-message-id][data-message-author-role]");
  if (ancestorMessage) out.add(ancestorMessage);

  const nested = node.querySelectorAll<HTMLElement>("[data-message-id][data-message-author-role]");
  for (const el of Array.from(nested)) out.add(el);
  return Array.from(out);
}
