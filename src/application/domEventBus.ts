import { FeatureContext } from "./featureContext";

export type BusChannel = "main" | "nav";

export type DomDelta = {
  channel: BusChannel;
  added: Element[];
  removed: Element[];
  reason: "mutation" | "route" | "rebind" | "initial";
  at: number;
};

export type Unsubscribe = () => void;

type RootSnapshot = { main: Element | null; nav: Element | null; reason: DomDelta["reason"] };

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
  const deltaSubscribers = new Map<BusChannel, Set<(delta: DomDelta) => void>>([
    ["main", new Set()],
    ["nav", new Set()]
  ]);
  const rootSubscribers = new Set<(roots: RootSnapshot) => void>();

  const stats = {
    mainObserverCalls: 0,
    navObserverCalls: 0,
    mainNodes: 0,
    navNodes: 0,
    emits: 0,
    rebinds: 0
  };

  let started = false;
  let pathUnsubscribe: Unsubscribe | null = null;

  const makeChannelState = (channel: BusChannel): ChannelState => {
    const flush = () => flushChannel(channel, "mutation");
    const { schedule, cancel } = ctx.helpers.createRafScheduler(flush);
    return {
      root: null,
      observer: null,
      pendingAdded: new Set<Element>(),
      pendingRemoved: new Set<Element>(),
      lastReason: "mutation",
      rafSchedule: schedule,
      rafCancel: cancel,
      debounceTimerId: null
    };
  };

  const mainState = makeChannelState("main");
  const navState = makeChannelState("nav");

  const getState = (channel: BusChannel) => (channel === "main" ? mainState : navState);

  const resolveRoot = (channel: BusChannel): Element | null => {
    if (channel === "main") {
      return document.querySelector("main") ?? document.querySelector('[role="main"]');
    }
    return document.querySelector('nav[aria-label="Chat history"]');
  };

  const notifyRoots = (reason: DomDelta["reason"]) => {
    const payload: RootSnapshot = { main: mainState.root, nav: navState.root, reason };
    for (const cb of Array.from(rootSubscribers)) {
      try {
        cb(payload);
      } catch {
        // ignore subscriber errors
      }
    }
  };

  const emit = (
    channel: BusChannel,
    reason: DomDelta["reason"],
    added: Element[],
    removed: Element[]
  ) => {
    stats.emits += 1;
    const delta: DomDelta = {
      channel,
      added,
      removed,
      reason,
      at: performance.now()
    };
    const listeners = deltaSubscribers.get(channel);
    if (!listeners || listeners.size === 0) return;
    for (const cb of Array.from(listeners)) {
      try {
        cb(delta);
      } catch {
        // ignore subscriber errors
      }
    }
  };

  const clearPending = (state: ChannelState) => {
    state.pendingAdded.clear();
    state.pendingRemoved.clear();
    if (state.debounceTimerId !== null) {
      window.clearTimeout(state.debounceTimerId);
      state.debounceTimerId = null;
    }
    state.rafCancel();
  };

  const flushChannel = (channel: BusChannel, reasonOverride?: DomDelta["reason"]) => {
    const state = getState(channel);
    if (!started) return;

    if (state.debounceTimerId !== null) {
      window.clearTimeout(state.debounceTimerId);
      state.debounceTimerId = null;
    }

    const added = Array.from(state.pendingAdded);
    const removed = Array.from(state.pendingRemoved);

    state.pendingAdded.clear();
    state.pendingRemoved.clear();

    const reason = reasonOverride ?? state.lastReason;
    if (added.length === 0 && removed.length === 0 && reason === "mutation") return;
    emit(channel, reason, added, removed);
  };

  const scheduleFlush = (channel: BusChannel) => {
    const state = getState(channel);
    state.rafSchedule();
  };

  const handleMutations = (channel: BusChannel, records: MutationRecord[]) => {
    const state = getState(channel);
    if (!started) return;

    const root = state.root;
    if (root && !root.isConnected) {
      rebind("rebind");
      return;
    }

    if (channel === "main") stats.mainObserverCalls += 1;
    else stats.navObserverCalls += 1;

    for (const record of records) {
      if (record.type !== "childList") continue;
      if (channel === "main")
        stats.mainNodes += record.addedNodes.length + record.removedNodes.length;
      else stats.navNodes += record.addedNodes.length + record.removedNodes.length;

      for (const node of Array.from(record.addedNodes)) {
        if (node instanceof Element) {
          state.pendingAdded.add(node);
          state.pendingRemoved.delete(node);
        }
      }
      for (const node of Array.from(record.removedNodes)) {
        if (node instanceof Element) {
          state.pendingRemoved.add(node);
          state.pendingAdded.delete(node);
        }
      }
    }

    state.lastReason = "mutation";
    scheduleFlush(channel);
  };

  const bindChannel = (channel: BusChannel, reason: DomDelta["reason"]) => {
    const state = getState(channel);
    state.observer?.disconnect();
    state.observer = null;
    clearPending(state);

    state.root = resolveRoot(channel);
    if (!state.root) {
      emit(channel, reason, [], []);
      return;
    }

    state.observer = new MutationObserver((records) => handleMutations(channel, records));
    state.observer.observe(state.root, { childList: true, subtree: true });

    emit(channel, reason, [], []);
  };

  const rebind = (reason: DomDelta["reason"]) => {
    if (!started) return;
    stats.rebinds += 1;
    bindChannel("main", reason);
    bindChannel("nav", reason);
    notifyRoots(reason);
  };

  const start = () => {
    if (started) return;
    started = true;
    pathUnsubscribe = ctx.helpers.onPathChange(() => {
      rebind("route");
    });
    rebind("initial");
  };

  const stop = () => {
    if (!started) return;
    started = false;
    pathUnsubscribe?.();
    pathUnsubscribe = null;

    for (const channel of ["main", "nav"] as const) {
      const state = getState(channel);
      state.observer?.disconnect();
      state.observer = null;
      state.root = null;
      clearPending(state);
    }

    deltaSubscribers.get("main")?.clear();
    deltaSubscribers.get("nav")?.clear();
    rootSubscribers.clear();
  };

  const onDelta = (channel: BusChannel, cb: (delta: DomDelta) => void): Unsubscribe => {
    const listeners = deltaSubscribers.get(channel);
    if (!listeners) return () => {};
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  };

  const onRoots = (cb: (roots: RootSnapshot) => void): Unsubscribe => {
    rootSubscribers.add(cb);
    return () => {
      rootSubscribers.delete(cb);
    };
  };

  return {
    start,
    stop,
    getMainRoot: () => mainState.root,
    getNavRoot: () => navState.root,
    onDelta,
    onRoots,
    stats: () => ({ ...stats })
  };
}
