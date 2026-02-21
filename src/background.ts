type DownloadPatchMessage = {
  type: "downloadPatch";
  filename: string;
  text: string;
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

type ChromeDownloads = {
  download?: (
    options: { url: string; filename: string; saveAs: boolean },
    callback: (downloadId?: number) => void
  ) => void;
};

type ChromeLikeApi = {
  runtime?: ChromeRuntime;
  downloads?: ChromeDownloads;
};

const chromeApi =
  (
    globalThis as typeof globalThis & {
      chrome?: ChromeLikeApi;
    }
  ).chrome ?? null;

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
          saveAs: true
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

    return { ok: true, downloadId };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to start patch download."
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
