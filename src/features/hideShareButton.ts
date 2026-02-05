import { FeatureContext, FeatureHandle } from "../application/featureContext";
import { norm } from "../lib/utils";

const STYLE_ID = "qqrm-hide-share-button-style";

export function initHideShareButtonFeature(ctx: FeatureContext): FeatureHandle {
  const state: {
    started: boolean;
    observer: MutationObserver | null;
    scheduled: boolean;
    hidden: HTMLElement[];
  } = {
    started: false,
    observer: null,
    scheduled: false,
    hidden: []
  };

  const isShareLabel = (value: string | null | undefined) => {
    const t = norm(value ?? "").trim();
    return t === "share" || t === "поделиться";
  };

  const ensureStyle = () => {
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
button[aria-label="Share"],
button[title="Share"],
button[aria-label="Поделиться"],
button[title="Поделиться"],
[role="button"][aria-label="Share"],
[role="button"][title="Share"],
[role="button"][aria-label="Поделиться"],
[role="button"][title="Поделиться"] {
  display: none !important;
}
`;
      document.documentElement.appendChild(style);
    }
    return style;
  };

  const removeStyle = () => {
    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();
  };

  const rememberHidden = (el: HTMLElement) => {
    if (el.dataset.qqrmHideShare === "1") return;
    el.dataset.qqrmHideShare = "1";
    el.style.display = "none";
    state.hidden.push(el);
  };

  const restoreHidden = () => {
    for (const el of state.hidden) {
      if (!el || !el.isConnected) continue;
      if (el.dataset.qqrmHideShare !== "1") continue;
      delete el.dataset.qqrmHideShare;
      el.style.display = "";
    }
    state.hidden = [];
  };

  const hasShareIcon = (el: Element) => {
    return Boolean(
      el.querySelector(
        'svg use[href*="#630ca2"], svg use[xlink\\:href*="#630ca2"], svg use[href*="#630ca2"], svg use[xlink\\:href*="#630ca2"]'
      )
    );
  };

  const findShareButtonCandidate = (node: Element): HTMLElement | null => {
    const el = node as HTMLElement;
    if (!el) return null;

    const tag = el.tagName ? el.tagName.toLowerCase() : "";
    if (tag === "button") return el;
    if (tag === "a" && el.getAttribute("role") === "button") return el;
    if (el.getAttribute("role") === "button") return el;

    const btn = el.closest<HTMLElement>("button, a[role=button], div[role=button]");
    return btn || null;
  };

  const scanAndHide = () => {
    if (!ctx.settings.hideShareButton) return;

    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>("button, a[role=button], div[role=button]")
    );

    for (const el of candidates) {
      if (!el || !el.isConnected) continue;
      if (el.dataset.qqrmHideShare === "1") continue;

      const aria = el.getAttribute("aria-label");
      const title = el.getAttribute("title");
      const text = el.textContent;

      if (isShareLabel(aria) || isShareLabel(title)) {
        rememberHidden(el);
        continue;
      }

      const t = norm(text).trim();
      if (t === "share" || t === "поделиться") {
        if (hasShareIcon(el) || el.querySelector("svg")) {
          rememberHidden(el);
          continue;
        }
      }
    }

    // Fallback for structures where the visible label is a nested <div> inside a button.
    const shareLabelDivs = Array.from(
      document.querySelectorAll<HTMLElement>("div.flex.w-full.items-center.justify-center")
    );
    for (const div of shareLabelDivs) {
      const t = norm(div.textContent).trim();
      if (t !== "share" && t !== "поделиться") continue;
      if (!div.querySelector("svg")) continue;

      const btn = findShareButtonCandidate(div);
      if (btn && btn.dataset.qqrmHideShare !== "1") {
        rememberHidden(btn);
      }
    }
  };

  const scheduleScan = () => {
    if (state.scheduled) return;
    state.scheduled = true;
    requestAnimationFrame(() => {
      state.scheduled = false;
      scanAndHide();
    });
  };

  const start = () => {
    if (state.started) return;
    state.started = true;

    ensureStyle();

    state.observer = new MutationObserver((mutations) => {
      const style = document.getElementById(STYLE_ID);
      if (
        style &&
        mutations.length > 0 &&
        mutations.every((mutation) => style.contains(mutation.target as Node))
      ) {
        return;
      }
      scheduleScan();
    });

    state.observer.observe(document.documentElement, { childList: true, subtree: true });
    scheduleScan();
  };

  const stop = () => {
    if (!state.started) return;
    state.started = false;

    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }

    removeStyle();
    restoreHidden();
  };

  const update = () => {
    if (ctx.settings.hideShareButton) start();
    else stop();
  };

  update();

  return {
    name: "hideShareButton",
    dispose: () => {
      stop();
    },
    onSettingsChange: (next, prev) => {
      if (next.hideShareButton !== prev.hideShareButton) {
        update();
      }
    },
    getStatus: () => ({ active: ctx.settings.hideShareButton })
  };
}
