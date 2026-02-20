type PathChangeListener = (path: string) => void;

type PatchedHistory = History & {
  __qqrmLocationWatcherPatched?: boolean;
  __qqrmLocationWatcherOriginalPushState?: History["pushState"];
  __qqrmLocationWatcherOriginalReplaceState?: History["replaceState"];
};

const listeners = new Set<PathChangeListener>();
let listening = false;
let lastPath = "";

const readPath = () => `${location.pathname}${location.search}${location.hash}`;

const notifyIfChanged = () => {
  const path = readPath();
  if (path === lastPath) return;
  lastPath = path;
  for (const listener of listeners) {
    listener(path);
  }
};

const patchHistoryOnce = () => {
  const historyWithPatch = history as PatchedHistory;
  if (historyWithPatch.__qqrmLocationWatcherPatched) return;

  historyWithPatch.__qqrmLocationWatcherPatched = true;
  historyWithPatch.__qqrmLocationWatcherOriginalPushState = history.pushState.bind(history);
  historyWithPatch.__qqrmLocationWatcherOriginalReplaceState = history.replaceState.bind(history);

  history.pushState = (...args) => {
    const result = historyWithPatch.__qqrmLocationWatcherOriginalPushState?.(...args);
    notifyIfChanged();
    return result;
  };

  history.replaceState = (...args) => {
    const result = historyWithPatch.__qqrmLocationWatcherOriginalReplaceState?.(...args);
    notifyIfChanged();
    return result;
  };
};

const unpatchHistory = () => {
  const historyWithPatch = history as PatchedHistory;
  if (!historyWithPatch.__qqrmLocationWatcherPatched) return;

  if (historyWithPatch.__qqrmLocationWatcherOriginalPushState) {
    history.pushState = historyWithPatch.__qqrmLocationWatcherOriginalPushState;
  }
  if (historyWithPatch.__qqrmLocationWatcherOriginalReplaceState) {
    history.replaceState = historyWithPatch.__qqrmLocationWatcherOriginalReplaceState;
  }

  historyWithPatch.__qqrmLocationWatcherPatched = false;
  historyWithPatch.__qqrmLocationWatcherOriginalPushState = undefined;
  historyWithPatch.__qqrmLocationWatcherOriginalReplaceState = undefined;
};

const onPopState = () => notifyIfChanged();

const startListening = () => {
  if (listening) return;
  listening = true;
  patchHistoryOnce();
  lastPath = readPath();
  window.addEventListener("popstate", onPopState);
};

const stopListening = () => {
  if (!listening) return;
  listening = false;
  window.removeEventListener("popstate", onPopState);
  unpatchHistory();
};

export const onPathChange = (listener: PathChangeListener) => {
  listeners.add(listener);
  startListening();

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopListening();
  };
};
