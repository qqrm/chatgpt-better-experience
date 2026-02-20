import { FeatureContext, FeatureHandle } from "../application/featureContext";

const PLACEHOLDER_ID = "qqrm-trim-chat-dom-placeholder";
const TURN_TRIMMED_ATTR = "data-qqrm-trimmed";
const TRIMMED_CLASS = "qqrm-trimmed";
const STYLE_ID = "qqrm-trim-chat-dom-style";

type RestoreMode = "quarter" | "half" | "all";

type State = {
  started: boolean;
  observer: MutationObserver | null;
  pathUnsubscribe: (() => void) | null;
  observedRoot: HTMLElement | null;
  extraKeep: number;
  hiddenUntilIndex: number;
  lastTurnCount: number;
  pendingReason: string;
  stats: { observerCalls: number; applyRuns: number; nodesProcessed: number };
};

export function initTrimChatDomFeature(ctx: FeatureContext): FeatureHandle {
  const state: State = {
    started: false,
    observer: null,
    pathUnsubscribe: null,
    observedRoot: null,
    extraKeep: 0,
    hiddenUntilIndex: 0,
    lastTurnCount: -1,
    pendingReason: "init",
    stats: { observerCalls: 0, applyRuns: 0, nodesProcessed: 0 }
  };

  const scheduleEnforce = ctx.helpers.createRafScheduler(() => enforce(state.pendingReason));

  const findRoot = (): HTMLElement | null =>
    (document.querySelector("main") as HTMLElement | null) ||
    (document.querySelector('[role="main"]') as HTMLElement | null) ||
    null;

  const findChatContainer = (root: HTMLElement): HTMLElement => {
    const thread =
      root.querySelector<HTMLElement>("[data-testid='conversation-turns']") ||
      root.querySelector<HTMLElement>("section") ||
      root;
    return thread;
  };

  const findTurns = (root: HTMLElement) => {
    const articles = Array.from(root.querySelectorAll<HTMLElement>("article"));
    return articles.filter((a) => a.querySelector("[data-message-author-role]"));
  };

  const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `.${TRIMMED_CLASS}{display:none !important;}`;
    (document.head ?? document.documentElement)?.appendChild(style);
  };

  const removeStyle = () => {
    document.getElementById(STYLE_ID)?.remove();
  };

  const removePlaceholder = () => {
    document.getElementById(PLACEHOLDER_ID)?.remove();
  };

  const computeRestoreExtra = (hiddenCount: number, mode: RestoreMode): number => {
    if (hiddenCount <= 0) return 0;
    if (mode === "all") return hiddenCount;
    if (mode === "half") return Math.ceil(hiddenCount * 0.5);
    return Math.ceil(hiddenCount * 0.25);
  };

  const buildPlaceholder = (): HTMLDivElement => {
    let el = document.getElementById(PLACEHOLDER_ID) as HTMLDivElement | null;
    if (el) return el;
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

    el.addEventListener("click", (ev) => {
      const target = ev.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>("button[data-qqrm-restore]");
      const mode = button?.getAttribute("data-qqrm-restore") as RestoreMode | null;
      if (!mode) return;
      const hiddenCount = Math.max(0, state.hiddenUntilIndex);
      state.extraKeep = Math.min(1000, state.extraKeep + computeRestoreExtra(hiddenCount, mode));
      state.pendingReason = "restore";
      enforce("restore");
      scheduleEnforce.schedule();
    });

    return el;
  };

  const updatePlaceholder = (
    host: Element,
    beforeEl: Element | null,
    hiddenCount: number,
    keep: number
  ) => {
    const el = buildPlaceholder();
    const msg = el.querySelector<HTMLElement>('[data-qqrm-part="msg"]');
    if (msg) {
      msg.textContent = `Performance mode: keeping last ${keep} messages in the DOM. Hidden ${hiddenCount} older messages.`;
    }

    if (el.parentElement !== host || (beforeEl && el.nextElementSibling !== beforeEl)) {
      if (beforeEl && beforeEl.parentElement === host) host.insertBefore(el, beforeEl);
      else if (host.firstChild) host.insertBefore(el, host.firstChild);
      else host.appendChild(el);
    }
  };

  const setTurnHidden = (turn: HTMLElement, hide: boolean) => {
    const alreadyHidden = turn.classList.contains(TRIMMED_CLASS);
    if (hide === alreadyHidden) return;
    turn.classList.toggle(TRIMMED_CLASS, hide);
    if (hide) turn.setAttribute(TURN_TRIMMED_ATTR, "1");
    else turn.removeAttribute(TURN_TRIMMED_ATTR);
  };

  const restoreAllInRoot = (root: HTMLElement | null) => {
    if (!root) return;
    const trimmed = root.querySelectorAll<HTMLElement>(`.${TRIMMED_CLASS}`);
    for (const turn of Array.from(trimmed)) {
      turn.classList.remove(TRIMMED_CLASS);
      turn.removeAttribute(TURN_TRIMMED_ATTR);
    }
  };

  const enforce = (reason: string) => {
    if (!ctx.settings.trimChatDom || !state.started) return;
    const root = findRoot();
    if (!root) return;

    const turns = findTurns(root);
    const keepBase = Math.min(50, Math.max(5, ctx.settings.trimChatDomKeep | 0));
    const keep = keepBase + Math.max(0, state.extraKeep | 0);
    const desiredHidden = Math.max(0, turns.length - keep);

    const forceBoundary =
      reason === "restore" || reason === "route" || state.lastTurnCount !== turns.length;
    if (!forceBoundary && desiredHidden === state.hiddenUntilIndex) return;

    state.stats.applyRuns += 1;
    const prevHidden = state.hiddenUntilIndex;

    if (desiredHidden > prevHidden) {
      for (let i = prevHidden; i < desiredHidden && i < turns.length; i += 1) {
        setTurnHidden(turns[i], true);
        state.stats.nodesProcessed += 1;
      }
    } else if (desiredHidden < prevHidden) {
      for (let i = desiredHidden; i < prevHidden && i < turns.length; i += 1) {
        setTurnHidden(turns[i], false);
        state.stats.nodesProcessed += 1;
      }
    }

    state.hiddenUntilIndex = desiredHidden;
    state.lastTurnCount = turns.length;

    if (desiredHidden > 0 && turns.length > 0) {
      const firstVisible = turns[desiredHidden] ?? turns[turns.length - 1];
      const host = firstVisible?.parentElement || root;
      updatePlaceholder(host, firstVisible, desiredHidden, keepBase);
    } else {
      removePlaceholder();
    }

    if (ctx.logger.isEnabled) {
      ctx.logger.debug("trimChatDom", `enforce:${reason}`, {
        preview: `observer=${state.stats.observerCalls} apply=${state.stats.applyRuns} nodes=${state.stats.nodesProcessed}`
      });
    }
  };

  const shouldReactToMutations = (records: MutationRecord[]) => {
    const placeholder = document.getElementById(PLACEHOLDER_ID);
    for (const record of records) {
      if (!(record.target instanceof Node)) continue;
      if (placeholder && placeholder.contains(record.target)) continue;
      if (record.type !== "childList") continue;
      for (const node of Array.from(record.addedNodes)) {
        if (!(node instanceof Element)) continue;
        if (node.matches("article") || node.querySelector("article, [data-message-author-role]"))
          return true;
      }
      for (const node of Array.from(record.removedNodes)) {
        if (!(node instanceof Element)) continue;
        if (node.matches("article") || node.querySelector("article, [data-message-author-role]"))
          return true;
      }
    }
    return false;
  };

  const bindObserver = () => {
    const root = findRoot();
    if (!root) return;
    const container = findChatContainer(root);
    if (container === state.observedRoot && state.observer) return;

    state.observer?.disconnect();
    state.observedRoot = container;
    state.observer = new MutationObserver((records) => {
      state.stats.observerCalls += 1;
      if (!shouldReactToMutations(records)) return;
      state.pendingReason = "mutation";
      scheduleEnforce.schedule();
    });
    state.observer.observe(container, { childList: true, subtree: true });
  };

  const handlePathChange = () => {
    state.extraKeep = 0;
    state.hiddenUntilIndex = 0;
    state.lastTurnCount = -1;
    restoreAllInRoot(findRoot());
    removePlaceholder();
    bindObserver();
    state.pendingReason = "route";
    scheduleEnforce.schedule();
  };

  const start = async () => {
    if (state.started) return;
    state.started = true;
    state.extraKeep = 0;
    state.hiddenUntilIndex = 0;
    state.lastTurnCount = -1;
    ensureStyle();

    await ctx.helpers.waitPresent('main, [role="main"]', document, 12000);
    if (!state.started) return;

    bindObserver();
    state.pathUnsubscribe = ctx.helpers.onPathChange(() => handlePathChange());
    state.pendingReason = "start";
    enforce("start");
    scheduleEnforce.schedule();
  };

  const stop = () => {
    if (!state.started) return;
    state.started = false;
    state.observer?.disconnect();
    state.observer = null;
    state.pathUnsubscribe?.();
    state.pathUnsubscribe = null;
    scheduleEnforce.cancel();
    restoreAllInRoot(findRoot());
    removePlaceholder();
    removeStyle();
    state.extraKeep = 0;
    state.hiddenUntilIndex = 0;
    state.lastTurnCount = -1;
  };

  const update = () => {
    if (ctx.settings.trimChatDom) void start();
    else stop();
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
        return;
      }
      if (next.trimChatDom && next.trimChatDomKeep !== prev.trimChatDomKeep) {
        state.pendingReason = "keep-change";
        scheduleEnforce.schedule();
      }
    },
    getStatus: () => ({
      active: ctx.settings.trimChatDom,
      details: ctx.settings.trimChatDom ? String(ctx.settings.trimChatDomKeep) : undefined
    })
  };
}
