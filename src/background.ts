type DownloadPatchMessage = {
  type: "downloadPatch";
  filename: string;
  text: string;
  saveAs?: boolean;
};

type DownloadPatchResponse = { ok: true; downloadId: number } | { ok: false; error: string };

type ChromeRuntime = {
  onMessage?: {
    addListener?: (
      listener: (
        message: unknown,
        sender: unknown,
        sendResponse: (response: DownloadPatchResponse) => void
      ) => boolean | void
    ) => void;
  };
  lastError?: { message?: string };
};

type DownloadDelta = {
  id: number;
  state?: { current?: string };
};

type ChromeDownloads = {
  download?: (
    options: { url: string; filename: string; saveAs?: boolean },
    callback: (downloadId?: number) => void
  ) => void;
  onChanged?: {
    addListener?: (listener: (delta: DownloadDelta) => void) => void;
  };
};

type ChromeLikeApi = {
  runtime?: ChromeRuntime;
  downloads?: ChromeDownloads;
};

const DOWNLOAD_BLOB_URL_TTL_MS = 120000;
const DOWNLOAD_COMPLETION_TIMEOUT_MS = 25000;

const chromeApi =
  (
    globalThis as typeof globalThis & {
      chrome?: ChromeLikeApi;
    }
  ).chrome ?? null;

const pendingBlobUrls = new Map<
  number,
  { url: string; timeoutId: ReturnType<typeof setTimeout> }
>();
const pendingDownloadWaiters = new Map<
  number,
  {
    resolve: (state: "complete" | "interrupted" | "timeout") => void;
    timeoutId: ReturnType<typeof setTimeout>;
  }
>();
let downloadChangeListenerInstalled = false;

function safeRevokeObjectUrl(url: string): void {
  try {
    URL.revokeObjectURL(url);
  } catch {
    // Ignore revoke errors.
  }
}

function cleanupTrackedBlobUrl(downloadId: number): void {
  const tracked = pendingBlobUrls.get(downloadId);
  if (!tracked) return;

  globalThis.clearTimeout(tracked.timeoutId);
  safeRevokeObjectUrl(tracked.url);
  pendingBlobUrls.delete(downloadId);
}

function trackBlobUrl(downloadId: number, url: string): void {
  cleanupTrackedBlobUrl(downloadId);
  const timeoutId = globalThis.setTimeout(() => {
    cleanupTrackedBlobUrl(downloadId);
  }, DOWNLOAD_BLOB_URL_TTL_MS);

  pendingBlobUrls.set(downloadId, { url, timeoutId });
}

function maybeInstallDownloadChangeListener(): void {
  if (downloadChangeListenerInstalled) return;
  const addListener = chromeApi?.downloads?.onChanged?.addListener;
  if (!addListener) return;

  addListener((delta) => {
    const state = delta?.state?.current;
    if (!state) return;
    if (state !== "complete" && state !== "interrupted") return;

    cleanupTrackedBlobUrl(delta.id);

    const pendingWaiter = pendingDownloadWaiters.get(delta.id);
    if (!pendingWaiter) return;

    globalThis.clearTimeout(pendingWaiter.timeoutId);
    pendingDownloadWaiters.delete(delta.id);
    pendingWaiter.resolve(state);
  });

  downloadChangeListenerInstalled = true;
}

function waitForDownloadTerminalState(
  downloadId: number,
  timeoutMs: number
): Promise<"complete" | "interrupted" | "timeout"> {
  return new Promise((resolve) => {
    const timeoutId = globalThis.setTimeout(() => {
      pendingDownloadWaiters.delete(downloadId);
      resolve("timeout");
    }, timeoutMs);

    pendingDownloadWaiters.set(downloadId, { resolve, timeoutId });
  });
}

maybeInstallDownloadChangeListener();

if (chromeApi?.runtime?.onMessage?.addListener) {
  chromeApi.runtime.onMessage.addListener((message: unknown, _sender: unknown, sendResponse) => {
    if (!isDownloadPatchMessage(message)) {
      return;
    }

    void handleDownloadPatchMessage(message).then(sendResponse);
    return true;
  });
}

function isDownloadPatchMessage(message: unknown): message is DownloadPatchMessage {
  if (!message || typeof message !== "object") return false;
  const candidate = message as Partial<DownloadPatchMessage>;
  return (
    candidate.type === "downloadPatch" &&
    typeof candidate.filename === "string" &&
    typeof candidate.text === "string"
  );
}

async function handleDownloadPatchMessage(
  message: DownloadPatchMessage
): Promise<DownloadPatchResponse> {
  if (!chromeApi?.downloads?.download) {
    return { ok: false, error: "Downloads API is unavailable." };
  }

  const blob = new Blob([message.text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    const downloadId = await new Promise<number>((resolve, reject) => {
      chromeApi.downloads?.download?.(
        {
          url,
          filename: message.filename,
          saveAs: typeof message.saveAs === "boolean" ? message.saveAs : false
        },
        (id?: number) => {
          const runtimeError = chromeApi.runtime?.lastError;
          if (runtimeError?.message) {
            reject(new Error(runtimeError.message));
            return;
          }

          if (typeof id !== "number") {
            reject(new Error("Download did not start."));
            return;
          }

          resolve(id);
        }
      );
    });

    trackBlobUrl(downloadId, url);

    const terminalState = await waitForDownloadTerminalState(
      downloadId,
      DOWNLOAD_COMPLETION_TIMEOUT_MS
    );

    if (terminalState === "complete") {
      return { ok: true, downloadId };
    }

    if (terminalState === "interrupted") {
      return { ok: false, error: "Download was interrupted." };
    }

    return {
      ok: false,
      error: "Timed out waiting for download completion."
    };
  } catch (error) {
    safeRevokeObjectUrl(url);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to start patch download."
    };
  }
}
