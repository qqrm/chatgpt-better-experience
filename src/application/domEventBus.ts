import type { FeatureContext } from "./featureContext";

export type BusChannel = "main" | "nav";
export type Unsubscribe = () => void;

export type DomDelta = {
  channel: BusChannel;
  added: Element[];
  removed: Element[];
  reason: "initial" | "route" | "mutation" | "rebind";
  at: number;
};

export type RootSnapshot = {
  main: Element | null;
  nav: Element | null;
  reason: DomDelta["reason"];
};

type ChannelState = {
  root: Element | null;
  observer: MutationObserver | null;
  pendingAdded: Set<Element>;
  pendingRemoved: Set<Element>;
  lastReason: DomDelta["reason"];
  rafSchedule: () => void;
  rafCancel: () => void;
  debounceTimerId: number | null;
};

export type DomEventBus = ReturnType<typeof createDomEventBus>;

export function createDomEventBus(ctx: FeatureContext) {
  const log = (event: string, msg: string, data?: Record<string, unknown>) =>
    ctx.logger.debug("DOMBUS", msg, data ? { event, ...data } : { event });

  const MAIN_ROOT_SELECTOR = 'main[role="main"]';
  const NAV_ROOT_SELECTOR = 'nav[aria-label="Chat history"]';

  const resolveRoot = (channel: BusChannel): Element | null => {
    const selector = channel === "main" ? MAIN_ROOT_SELECTOR : NAV_ROOT_SELECTOR;
    return ctx.helpers.safeQuery(selector);
  };

  const extractAddedElements = (records: MutationRecord[]) =>
    ctx.helpers.extractAddedElements(records);

  const stats = {
    startedAt: 0,
    channelMutations: { main: 0, nav: 0 },
    emits: { main: 0, nav: 0 },
    rebinds: 0,
    disconnects: { main: 0, nav: 0 },
    lastEmitAt: 0
  };

  let started = false;
  let disposed = false;
  let pathUnsubscribe: Unsubscribe | null = null;

  const listeners = new Map<BusChannel, Set<(delta: DomDelta) => void>>([
    ["main", new Set()],
    ["nav", new Set()]
  ]);

  const rootSubscribers = new Set<(roots: RootSnapshot) => void>();

  const makeChannelState = (channel: BusChannel): ChannelState => {
    const { schedule, cancel } = ctx.helpers.createRafScheduler(() => flush(channel));

    return {
      root: null,
      observer: null,
      pendingAdded: new Set<Element>(),
      pendingRemoved: new Set<Element>(),
      lastReason: "initial",
      rafSchedule: schedule,
      rafCancel: cancel,
      debounceTimerId: null
    };
  };

  const mainState = makeChannelState("main");
  const navState = makeChannelState("nav");

  const getState = (channel: BusChannel) => (channel === "main" ? mainState : navState);

  const getDeltaSubscriberCount = (channel: BusChannel) => listeners.get(channel)?.size ?? 0;

  const hasAnySubscribers = () =>
    getDeltaSubscriberCount("main") + getDeltaSubscriberCount("nav") + rootSubscribers.size > 0;

  const channelNeedsObservation = (channel: BusChannel) => getDeltaSubscriberCount(channel) > 0;

  const channelWantsBinding = (channel: BusChannel) =>
    channelNeedsObservation(channel) || rootSubscribers.size > 0;

  const disconnectChannel = (channel: BusChannel) => {
    const state = getState(channel);
    stats.disconnects[channel] += 1;

    state.rafCancel();
    if (state.debounceTimerId !== null) {
      window.clearTimeout(state.debounceTimerId);
      state.debounceTimerId = null;
    }
    state.pendingAdded.clear();
    state.pendingRemoved.clear();

    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
  };

  const bindChannel = (channel: BusChannel, reason: DomDelta["reason"]) => {
    const state = getState(channel);
    disconnectChannel(channel);

    state.lastReason = reason;
    state.root = resolveRoot(channel);

    if (started && channelNeedsObservation(channel) && state.root) {
      const { observer } = ctx.helpers.observe(state.root, (mutations) => {
        if (!started || disposed) return;
        stats.channelMutations[channel] += mutations.length;

        for (const el of extractAddedElements(mutations)) state.pendingAdded.add(el);
        for (const m of mutations) {
          if (m.type !== "childList") continue;
          for (const node of Array.from(m.removedNodes)) {
            if (node.nodeType === Node.ELEMENT_NODE) state.pendingRemoved.add(node as Element);
          }
        }

        // Coalesce bursts; flush via RAF.
        state.lastReason = "mutation";
        state.rafSchedule();
      });

      state.observer = observer;
    }

    // Emit an initial/route tick for this channel so subscribers can "sync".
    emit(channel, reason, [], []);
  };

  const emit = (
    channel: BusChannel,
    reason: DomDelta["reason"],
    added: Element[],
    removed: Element[]
  ) => {
    const set = listeners.get(channel);
    if (!set || set.size === 0) return;

    stats.emits[channel] += 1;
    stats.lastEmitAt = Date.now();

    const delta: DomDelta = {
      channel,
      added,
      removed,
      reason,
      at: stats.lastEmitAt
    };

    for (const cb of set) {
      try {
        cb(delta);
      } catch (e) {
        log("callback_error", "delta callback error", {
          channel,
          reason,
          error: String(e)
        });
      }
    }
  };

  const notifyRoots = (reason: DomDelta["reason"]) => {
    if (rootSubscribers.size === 0) return;

    const snap: RootSnapshot = {
      main: mainState.root,
      nav: navState.root,
      reason
    };

    for (const cb of rootSubscribers) {
      try {
        cb(snap);
      } catch (e) {
        log("callback_error", "roots callback error", {
          reason,
          error: String(e)
        });
      }
    }
  };

  const flush = (channel: BusChannel) => {
    const state = getState(channel);
    if (!started || disposed) return;

    const added = Array.from(state.pendingAdded);
    const removed = Array.from(state.pendingRemoved);
    state.pendingAdded.clear();
    state.pendingRemoved.clear();

    const reason = state.lastReason;
    state.lastReason = "mutation";

    emit(channel, reason, added, removed);
  };

  const rebind = (reason: DomDelta["reason"]) => {
    if (!started || disposed) return;

    stats.rebinds += 1;

    for (const channel of ["main", "nav"] as const) {
      if (channelWantsBinding(channel)) {
        bindChannel(channel, reason);
      } else {
        disconnectChannel(channel);
        getState(channel).root = null;
      }
    }

    notifyRoots(reason);
  };

  const stop = () => {
    if (!started) return;
    started = false;

    log("stop", "stopping dom bus", {
      uptimeMs: Date.now() - stats.startedAt
    });

    pathUnsubscribe?.();
    pathUnsubscribe = null;

    disconnectChannel("main");
    disconnectChannel("nav");

    mainState.root = null;
    navState.root = null;
  };

  const stopIfIdle = () => {
    if (!hasAnySubscribers()) stop();
  };

  const start = () => {
    if (started || disposed) return;
    if (!hasAnySubscribers()) return;

    started = true;
    stats.startedAt = Date.now();

    log("start", "starting dom bus", {
      hasMainSubs: getDeltaSubscriberCount("main"),
      hasNavSubs: getDeltaSubscriberCount("nav"),
      hasRootSubs: rootSubscribers.size
    });

    pathUnsubscribe = ctx.helpers.onPathChange(() => {
      // Rebind on SPA route changes; bind only channels that are needed.
      rebind("route");
    });

    rebind("initial");
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;

    log("dispose", "disposing dom bus", {});

    for (const set of listeners.values()) set.clear();
    rootSubscribers.clear();
    stop();
  };

  const onDelta = (channel: BusChannel, cb: (delta: DomDelta) => void) => {
    if (disposed) return () => {};

    const set = listeners.get(channel);
    if (!set) return () => {};

    const wasEmpty = set.size === 0;
    set.add(cb);

    // If we were started and this is the first subscriber for the channel,
    // ensure that channel is bound immediately.
    if (started && wasEmpty) {
      bindChannel(channel, "route");
    } else if (!started) {
      start();
    }

    return () => {
      const cur = listeners.get(channel);
      if (!cur) return;
      cur.delete(cb);

      if (cur.size === 0) {
        disconnectChannel(channel);
        getState(channel).root = null;
      }

      stopIfIdle();
    };
  };

  const onRoots = (cb: (roots: RootSnapshot) => void) => {
    if (disposed) return () => {};

    const wasStarted = started;
    const wasEmpty = rootSubscribers.size === 0;

    rootSubscribers.add(cb);

    if (!wasStarted) {
      start();
    } else if (wasEmpty) {
      // Roots now matter; ensure we bind both roots and notify immediately.
      rebind("route");
    } else {
      try {
        cb({ main: mainState.root, nav: navState.root, reason: "route" });
      } catch (e) {
        log("callback_error", "roots callback error", {
          reason: "route",
          error: String(e)
        });
      }
    }

    return () => {
      rootSubscribers.delete(cb);
      stopIfIdle();
    };
  };

  return {
    start,
    stop,
    dispose,
    onDelta,
    onRoots,
    getMainRoot: () => mainState.root,
    getNavRoot: () => navState.root,
    getStats: () => ({
      ...stats,
      started,
      disposed,
      mainSubs: getDeltaSubscriberCount("main"),
      navSubs: getDeltaSubscriberCount("nav"),
      rootSubs: rootSubscribers.size
    }),
    stats: () => ({
      mainObserverCalls: stats.channelMutations.main,
      navObserverCalls: stats.channelMutations.nav,
      mainNodes: stats.emits.main,
      navNodes: stats.emits.nav,
      emits: stats.emits.main + stats.emits.nav,
      rebinds: stats.rebinds
    })
  };
}
