import { FeatureContext, FeatureHandle } from "../application/featureContext";

const PLACEHOLDER_ID = "qqrm-trim-chat-dom-placeholder";
const TURN_TRIMMED_ATTR = "data-qqrm-trimmed";

type RestoreMode = "quarter" | "half" | "all";

type State = {
  started: boolean;
  observer: MutationObserver | null;
  intervalId: number | null;
  lastPath: string;
  suppress: boolean;
  scheduled: boolean;
  extraKeep: number;
};

export function initTrimChatDomFeature(ctx: FeatureContext): FeatureHandle {
  const state: State = {
    started: false,
    observer: null,
    intervalId: null,
    lastPath: location.pathname,
    suppress: false,
    scheduled: false,
    extraKeep: 0
  };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const findRoot = (): HTMLElement | null =>
    (document.querySelector("main") as HTMLElement | null) ||
    (document.querySelector('[role="main"]') as HTMLElement | null) ||
    null;

  const findTurns = (root: HTMLElement) => {
    const articles = Array.from(root.querySelectorAll<HTMLElement>("article"));
    return articles.filter((a) => a.querySelector("[data-message-author-role]"));
  };

  const removePlaceholder = () => {
    const el = document.getElementById(PLACEHOLDER_ID);
    if (el) el.remove();
  };

  const buildPlaceholder = (): HTMLDivElement => {
    let el = document.getElementById(PLACEHOLDER_ID) as HTMLDivElement | null;
    if (!el) {
      el = document.createElement("div");
      el.id = PLACEHOLDER_ID;
      el.style.margin = "10px 0";
      el.style.padding = "10px 12px";
      el.style.border = "1px solid rgba(127,127,127,0.35)";
      el.style.borderRadius = "10px";
      el.style.fontSize = "12px";
      el.style.opacity = "0.9";
      el.style.userSelect = "text";
      el.style.whiteSpace = "pre-wrap";
      el.style.display = "flex";
      el.style.gap = "10px";
      el.style.alignItems = "center";
      el.style.flexWrap = "wrap";

      const msg = document.createElement("div");
      msg.setAttribute("data-qqrm-part", "msg");

      const btnWrap = document.createElement("div");
      btnWrap.style.display = "flex";
      btnWrap.style.gap = "8px";
      btnWrap.style.flexWrap = "wrap";

      const mkBtn = (label: string, mode: RestoreMode) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.setAttribute("data-qqrm-restore", mode);
        b.style.border = "1px solid rgba(127,127,127,0.35)";
        b.style.borderRadius = "10px";
        b.style.padding = "4px 8px";
        b.style.fontSize = "12px";
        b.style.background = "transparent";
        b.style.cursor = "pointer";
        b.style.color = "inherit";
        return b;
      };

      btnWrap.appendChild(mkBtn("Restore 25%", "quarter"));
      btnWrap.appendChild(mkBtn("Restore 50%", "half"));
      btnWrap.appendChild(mkBtn("Restore all", "all"));

      el.appendChild(msg);
      el.appendChild(btnWrap);

      el.addEventListener(
        "click",
        (ev) => {
          const t = ev.target as HTMLElement | null;
          if (!t) return;
          const b = t.closest<HTMLButtonElement>("button[data-qqrm-restore]");
          if (!b) return;
          const mode = b.getAttribute("data-qqrm-restore") as RestoreMode | null;
          if (!mode) return;
          void onRestore(mode);
        },
        true
      );
    }
    return el;
  };

  const updatePlaceholderText = (hiddenCount: number, keep: number) => {
    const el = buildPlaceholder();
    const msg = el.querySelector<HTMLElement>('[data-qqrm-part="msg"]');
    if (msg) {
      msg.textContent =
        `Performance mode: keeping last ${keep} messages in the DOM. ` +
        `Hidden ${hiddenCount} older messages.`;
    }
  };

  const insertPlaceholder = (
    host: Element,
    beforeEl: Element | null,
    hiddenCount: number,
    keep: number
  ) => {
    const el = buildPlaceholder();
    updatePlaceholderText(hiddenCount, keep);

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

  const setTurnHidden = (turn: HTMLElement, hide: boolean) => {
    if (hide) {
      turn.setAttribute(TURN_TRIMMED_ATTR, "1");
      turn.style.display = "none";
    } else {
      turn.removeAttribute(TURN_TRIMMED_ATTR);
      turn.style.display = "";
    }
  };

  const computeRestoreExtra = (hiddenCount: number, mode: RestoreMode): number => {
    if (hiddenCount <= 0) return 0;
    if (mode === "all") return hiddenCount;
    if (mode === "half") return Math.ceil(hiddenCount * 0.5);
    return Math.ceil(hiddenCount * 0.25);
  };

  const onRestore = async (mode: RestoreMode) => {
    if (!ctx.settings.trimChatDom) return;

    const root = findRoot();
    if (!root) return;

    const turns = findTurns(root);
    const trimmed = turns.filter((t) => t.getAttribute(TURN_TRIMMED_ATTR) === "1");
    const hiddenCount = trimmed.length;

    const add = computeRestoreExtra(hiddenCount, mode);
    state.extraKeep = Math.min(1000, state.extraKeep + add);

    // Give the UI a tick to settle, then re-apply with the new keep.
    await sleep(0);
    scheduleEnforce();
  };

  const enforce = () => {
    if (!ctx.settings.trimChatDom) return;

    const root = findRoot();
    if (!root) return;

    if (location.pathname !== state.lastPath) {
      state.lastPath = location.pathname;
      state.extraKeep = 0;
      // Restore everything when switching chats.
      for (const t of findTurns(root)) setTurnHidden(t, false);
      removePlaceholder();
    }

    const turns = findTurns(root);
    const keepBase = Math.min(50, Math.max(5, ctx.settings.trimChatDomKeep | 0));
    const keep = keepBase + Math.max(0, state.extraKeep | 0);

    // Desired: only the last `keep` turns are visible.
    const desiredHidden = Math.max(0, turns.length - keep);

    state.suppress = true;
    for (let i = 0; i < turns.length; i++) {
      const shouldHide = i < desiredHidden;
      setTurnHidden(turns[i], shouldHide);
    }
    state.suppress = false;

    const hiddenCount = desiredHidden;

    if (hiddenCount > 0 && turns.length > 0) {
      const firstVisible = turns[desiredHidden] ?? turns[turns.length - 1];
      const host = firstVisible?.parentElement || root;
      insertPlaceholder(host, firstVisible, hiddenCount, keepBase);
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
    state.extraKeep = 0;

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

    const root = findRoot();
    if (root) {
      for (const t of findTurns(root)) setTurnHidden(t, false);
    }
    removePlaceholder();
    state.extraKeep = 0;
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
        // If user reduced keep, clamp extraKeep so we don't grow unbounded.
        state.extraKeep = Math.min(state.extraKeep, 1000);
        scheduleEnforce();
      }
    },
    getStatus: () => ({
      active: ctx.settings.trimChatDom,
      details: ctx.settings.trimChatDom ? String(ctx.settings.trimChatDomKeep) : undefined
    })
  };
}
