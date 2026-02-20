(() => {
  const SOURCE = "qqrm-clipboard-hook";
  const INSTALLED_FLAG = "__qqrmClipboardHookInstalled__";
  const CAPTURE_EXPIRY_MS = 2500;

  const g = globalThis as typeof globalThis & {
    [INSTALLED_FLAG]?: boolean;
  };

  if (g[INSTALLED_FLAG]) return;
  g[INSTALLED_FLAG] = true;

  const clipboardApi = navigator.clipboard as
    | (Clipboard & {
        writeText?: (text: string) => Promise<void>;
        write?: (items: ClipboardItems) => Promise<void>;
      })
    | undefined;

  const originalWriteText = clipboardApi?.writeText?.bind(clipboardApi);
  const originalWrite = clipboardApi?.write?.bind(clipboardApi);

  let activeCaptureId: string | null = null;
  let captureTimerId: number | null = null;

  const clearCapture = () => {
    activeCaptureId = null;
    if (captureTimerId !== null) {
      window.clearTimeout(captureTimerId);
      captureTimerId = null;
    }
  };

  const postCaptured = (text: string | null | undefined) => {
    if (!activeCaptureId) return;
    window.postMessage(
      {
        source: SOURCE,
        type: "captured",
        id: activeCaptureId,
        text: text ?? ""
      },
      "*"
    );
    clearCapture();
  };

  const beginCapture = (id: string) => {
    clearCapture();
    activeCaptureId = id;
    captureTimerId = window.setTimeout(() => {
      clearCapture();
    }, CAPTURE_EXPIRY_MS);
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const raw = event.data as unknown;
    if (!raw || typeof raw !== "object") return;
    const data = raw as { source?: string; type?: string; id?: string };
    if (data.source !== SOURCE || data.type !== "begin" || !data.id) return;
    beginCapture(data.id);
  });

  if (clipboardApi && originalWriteText) {
    clipboardApi.writeText = async (text: string) => {
      if (activeCaptureId) {
        postCaptured(text);
      }
      return originalWriteText(text);
    };
  }

  if (clipboardApi && originalWrite) {
    clipboardApi.write = async (items: ClipboardItems) => {
      if (activeCaptureId) {
        let capturedText = "";
        try {
          for (const item of items) {
            if (!item.types.includes("text/plain")) continue;
            const blob = await item.getType("text/plain");
            capturedText = await blob.text();
            break;
          }
        } catch {
          capturedText = "";
        }
        postCaptured(capturedText);
      }
      return originalWrite(items);
    };
  }

  document.addEventListener(
    "copy",
    (event) => {
      if (!activeCaptureId) return;
      const copied =
        event.clipboardData?.getData("text/plain") || window.getSelection()?.toString() || "";
      postCaptured(copied);
    },
    true
  );
})();
