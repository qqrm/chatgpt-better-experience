(() => {
  const SOURCE = "qqrm-clipboard-hook";
  const INSTALLED_FLAG = "__qqrmClipboardHookInstalled__";
  const CAPTURE_EXPIRY_MS = 7000;
  const HOOK_VERSION = "1";

  type CaptureMode = "capture-only" | "passthrough";
  type ActiveCapture = { id: string; mode: CaptureMode };

  const g = globalThis as typeof globalThis & {
    [INSTALLED_FLAG]?: boolean;
  };

  const postReady = () => {
    window.postMessage(
      {
        source: SOURCE,
        type: "ready",
        version: HOOK_VERSION
      },
      "*"
    );
  };

  if (g[INSTALLED_FLAG]) {
    postReady();
    return;
  }
  g[INSTALLED_FLAG] = true;

  const clipboardApi = navigator.clipboard as
    | (Clipboard & {
        writeText?: (text: string) => Promise<void>;
        write?: (items: ClipboardItems) => Promise<void>;
      })
    | undefined;

  const originalWriteText = clipboardApi?.writeText?.bind(clipboardApi);
  const originalWrite = clipboardApi?.write?.bind(clipboardApi);

  let activeCapture: ActiveCapture | null = null;
  let captureTimerId: number | null = null;

  const clearCapture = () => {
    activeCapture = null;
    if (captureTimerId !== null) {
      window.clearTimeout(captureTimerId);
      captureTimerId = null;
    }
  };

  const postCaptured = (
    text: string | null | undefined,
    transport?: "writeText" | "write" | "copy-event"
  ) => {
    if (!activeCapture) return;
    window.postMessage(
      {
        source: SOURCE,
        type: "captured",
        id: activeCapture.id,
        text: text ?? "",
        transport
      },
      "*"
    );
    clearCapture();
  };

  const beginCapture = (id: string, mode?: CaptureMode) => {
    clearCapture();
    activeCapture = { id, mode: mode ?? "passthrough" };
    captureTimerId = window.setTimeout(() => {
      clearCapture();
    }, CAPTURE_EXPIRY_MS);
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const raw = event.data as unknown;
    if (!raw || typeof raw !== "object") return;
    const data = raw as { source?: string; type?: string; id?: string; mode?: CaptureMode };
    if (data.source !== SOURCE || data.type !== "begin" || !data.id) return;
    beginCapture(data.id, data.mode);
  });

  if (clipboardApi && originalWriteText) {
    clipboardApi.writeText = async (text: string) => {
      if (activeCapture) {
        const mode = activeCapture.mode;
        postCaptured(text, "writeText");
        if (mode === "capture-only") return;
      }
      return originalWriteText(text);
    };
  }

  if (clipboardApi && originalWrite) {
    clipboardApi.write = async (items: ClipboardItems) => {
      if (activeCapture) {
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

        const mode = activeCapture.mode;
        postCaptured(capturedText, "write");
        if (mode === "capture-only") return;
      }
      return originalWrite(items);
    };
  }

  document.addEventListener(
    "copy",
    (event) => {
      if (!activeCapture) return;
      const copied =
        event.clipboardData?.getData("text/plain") || window.getSelection()?.toString() || "";
      postCaptured(copied, "copy-event");
    },
    true
  );

  postReady();
})();
