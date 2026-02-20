import { FeatureContext, FeatureHandle } from "../application/featureContext";

const PLACEHOLDER_ID = "qqrm-trim-chat-dom-placeholder";
const TURN_TRIMMED_ATTR = "data-qqrm-trimmed";
const TRIMMED_CLASS = "qqrm-trimmed";
const STYLE_ID = "qqrm-trim-chat-dom-style";

type RestoreMode = "quarter" | "half" | "all";

type State = {
  started: boolean;
  trackedMainRoot: HTMLElement | null;
  extraKeep: number;
  hiddenUntilIndex: number;
  lastTurnCount: number;
  pendingReason: string;
  unsubMainDelta: (() => void) | null;
  unsubRoots: (() => void) | null;
  stats: { applyRuns: number; nodesProcessed: number; busEvents: number };
};

export function initTrimChatDomFeature(ctx: FeatureContext): FeatureHandle {
  const state: State = {
    started: false,
    trackedMainRoot: null,
    extraKeep: 0,
    hiddenUntilIndex: 0,
    lastTurnCount: -1,
    pendingReason: "init",
    unsubMainDelta: null,
    unsubRoots: null,
    stats: { applyRuns: 0, nodesProcessed: 0, busEvents: 0 }
  };

  const scheduleEnforce = ctx.helpers.createRafScheduler(() => enforce(state.pendingReason));

  const findRoot = (): HTMLElement | null =>
    (ctx.domBus?.getMainRoot() as HTMLElement | null) ??
    (document.querySelector("main") as HTMLElement | null) ??
    (document.querySelector('[role="main"]') as HTMLElement | null) ??
    null;

  const findChatContainer = (root: HTMLElement): HTMLElement => {
    return (
      root.querySelector<HTMLElement>("[data-testid='conversation-turns']") ??
      root.querySelector<HTMLElement>("section") ??
      root
    );
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

  const removeStyle = () => document.getElementById(STYLE_ID)?.remove();
  const removePlaceholder = () => document.getElementById(PLACEHOLDER_ID)?.remove();

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
    el.style.cssText =
      "margin:10px 0;padding:10px 12px;border:1px solid rgba(127,127,127,0.35);border-radius:10px;font-size:12px;opacity:0.9;user-select:text;white-space:pre-wrap;display:flex;gap:10px;align-items:center;flex-wrap:wrap;";

    const msg = document.createElement("div");
    msg.setAttribute("data-qqrm-part", "msg");
    const btnWrap = document.createElement("div");
    btnWrap.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";

    const mkBtn = (label: string, mode: RestoreMode) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.setAttribute("data-qqrm-restore", mode);
      b.style.cssText =
        "border:1px solid rgba(127,127,127,0.35);border-radius:10px;padding:4px 8px;font-size:12px;background:transparent;cursor:pointer;color:inherit;";
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

    const turns = findTurns(findChatContainer(root));
    const keepBase = Math.min(50, Math.max(5, ctx.settings.trimChatDomKeep | 0));
    const keep = keepBase + Math.max(0, state.extraKeep | 0);
    const desiredHidden = Math.max(0, turns.length - keep);

    const forceBoundary =
      reason === "restore" ||
      reason === "route" ||
      reason === "rebind" ||
      state.lastTurnCount !== turns.length;
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
        preview: `bus=${state.stats.busEvents} apply=${state.stats.applyRuns} nodes=${state.stats.nodesProcessed}`
      });
    }
  };

  const isRelevantElement = (el: Element) =>
    el.matches("article") ||
    el.matches("[data-message-author-role]") ||
    !!el.querySelector("article, [data-message-author-role]");

  const isRelevantDelta = (added: Element[], removed: Element[]) => {
    for (const el of added) if (isRelevantElement(el)) return true;
    for (const el of removed) if (isRelevantElement(el)) return true;
    return false;
  };

  const resetForRootChange = (nextRoot: HTMLElement | null, reason: string) => {
    const previousRoot = state.trackedMainRoot;
    state.trackedMainRoot = nextRoot;
    state.extraKeep = 0;
    state.hiddenUntilIndex = 0;
    state.lastTurnCount = -1;
    restoreAllInRoot(previousRoot);
    removePlaceholder();
    state.pendingReason = reason;
    scheduleEnforce.schedule();
  };

  const start = async () => {
    if (state.started) return;
    state.started = true;
    ensureStyle();

    await ctx.helpers.waitPresent('main, [role="main"]', document, 12000);
    if (!state.started) return;

    state.unsubRoots =
      ctx.domBus?.onRoots((roots) => {
        resetForRootChange(roots.main as HTMLElement | null, roots.reason);
      }) ?? null;

    state.unsubMainDelta =
      ctx.domBus?.onDelta("main", (delta) => {
        state.stats.busEvents += 1;
        state.stats.nodesProcessed += delta.added.length + delta.removed.length;
        if (!isRelevantDelta(delta.added, delta.removed)) return;
        state.pendingReason = "mutation";
        scheduleEnforce.schedule();
      }) ?? null;

    resetForRootChange(findRoot(), "start");
    enforce("start");
  };

  const stop = () => {
    if (!state.started) return;
    state.started = false;
    state.unsubMainDelta?.();
    state.unsubMainDelta = null;
    state.unsubRoots?.();
    state.unsubRoots = null;
    scheduleEnforce.cancel();
    restoreAllInRoot(findRoot());
    removePlaceholder();
    removeStyle();
    state.trackedMainRoot = null;
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
    dispose: () => stop(),
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
