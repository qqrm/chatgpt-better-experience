import { FeatureContext, FeatureHandle } from "../application/featureContext";

const PLACEHOLDER_ID = "qqrm-trim-chat-dom-placeholder";

export function initTrimChatDomFeature(ctx: FeatureContext): FeatureHandle {
  const state: {
    started: boolean;
    observer: MutationObserver | null;
    intervalId: number | null;
    removedCount: number;
    lastPath: string;
    suppress: boolean;
    scheduled: boolean;
  } = {
    started: false,
    observer: null,
    intervalId: null,
    removedCount: 0,
    lastPath: location.pathname,
    suppress: false,
    scheduled: false
  };

  const findRoot = () =>
    (document.querySelector("main") as HTMLElement | null) ||
    (document.querySelector('[role="main"]') as HTMLElement | null) ||
    null;

  const findTurns = (root: HTMLElement) => {
    const articles = Array.from(root.querySelectorAll("article"));
    return articles.filter((a) => a.querySelector("[data-message-author-role]"));
  };

  const removePlaceholder = () => {
    const el = document.getElementById(PLACEHOLDER_ID);
    if (el) el.remove();
  };

  const ensurePlaceholder = (host: Element, beforeEl: Element | null) => {
    let el = document.getElementById(PLACEHOLDER_ID) as HTMLDivElement | null;
    if (!el) {
      el = document.createElement("div");
      el.id = PLACEHOLDER_ID;
      el.style.margin = "10px 0";
      el.style.padding = "8px 12px";
      el.style.border = "1px solid rgba(127,127,127,0.35)";
      el.style.borderRadius = "10px";
      el.style.fontSize = "12px";
      el.style.opacity = "0.82";
      el.style.userSelect = "text";
      el.style.whiteSpace = "pre-wrap";
    }

    const keep = ctx.settings.trimChatDomKeep;
    el.textContent =
      `Performance mode: keeping last ${keep} messages in the DOM. ` +
      `Removed ${state.removedCount} older messages (reload to restore).`;

    try {
      if (beforeEl && beforeEl.parentElement === host) {
        host.insertBefore(el, beforeEl);
      } else {
        host.insertBefore(el, host.firstChild);
      }
    } catch {
      try {
        host.appendChild(el);
      } catch {
        // ignore
      }
    }
  };

  const enforce = () => {
    if (!ctx.settings.trimChatDom) return;

    const root = findRoot();
    if (!root) return;

    if (location.pathname !== state.lastPath) {
      state.lastPath = location.pathname;
      state.removedCount = 0;
      removePlaceholder();
    }

    const turns = findTurns(root);
    const keep = Math.min(50, Math.max(5, ctx.settings.trimChatDomKeep | 0));

    if (turns.length > keep) {
      const removeN = turns.length - keep;
      state.suppress = true;
      for (let i = 0; i < removeN; i++) {
        try {
          turns[i].remove();
          state.removedCount += 1;
        } catch {
          // ignore
        }
      }
      state.suppress = false;
    }

    const after = findTurns(root);
    if (state.removedCount > 0 && after.length > 0) {
      const first = after[0];
      const host = first.parentElement || root;
      ensurePlaceholder(host, first);
    } else {
      removePlaceholder();
    }
  };

  const scheduleEnforce = () => {
    if (state.scheduled) return;
    state.scheduled = true;
    requestAnimationFrame(() => {
      state.scheduled = false;
      enforce();
    });
  };

  const start = async () => {
    if (state.started) return;
    state.started = true;
    state.lastPath = location.pathname;
    state.removedCount = 0;

    await ctx.helpers.waitPresent('main, [role="main"]', document, 12000);

    state.observer = new MutationObserver((mutations) => {
      if (state.suppress) return;
      const ph = document.getElementById(PLACEHOLDER_ID);
      if (
        ph &&
        mutations.length > 0 &&
        mutations.every((mutation) =>
          mutation.target instanceof Node ? ph.contains(mutation.target) : false
        )
      ) {
        return;
      }
      scheduleEnforce();
    });

    state.observer.observe(document.documentElement, { childList: true, subtree: true });

    state.intervalId = window.setInterval(() => {
      if (!ctx.settings.trimChatDom) return;
      if (location.pathname !== state.lastPath) scheduleEnforce();
    }, 800);

    scheduleEnforce();
  };

  const stop = () => {
    if (!state.started) return;
    state.started = false;

    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
    if (state.intervalId !== null) {
      window.clearInterval(state.intervalId);
      state.intervalId = null;
    }

    removePlaceholder();
  };

  const update = () => {
    if (ctx.settings.trimChatDom) {
      void start();
    } else {
      stop();
    }
  };

  update();

  return {
    name: "trimChatDom",
    dispose: () => {
      stop();
    },
    onSettingsChange: (next, prev) => {
      if (next.trimChatDom !== prev.trimChatDom) {
        update();
        if (next.trimChatDom) scheduleEnforce();
        return;
      }
      if (next.trimChatDom && next.trimChatDomKeep !== prev.trimChatDomKeep) {
        scheduleEnforce();
      }
    },
    getStatus: () => ({
      active: ctx.settings.trimChatDom,
      details: ctx.settings.trimChatDom ? String(ctx.settings.trimChatDomKeep) : undefined
    })
  };
}
