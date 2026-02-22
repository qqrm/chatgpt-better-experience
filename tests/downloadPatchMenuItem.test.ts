import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeTestContext } from "./helpers/testContext";
import { initDownloadPatchMenuItemFeature } from "../src/features/downloadPatchMenuItem";

const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 60));
};

const findDownloadMenuItem = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (el) => (el.textContent ?? "").trim() === "Download Patch"
  );

describe("downloadPatchMenuItem", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    history.pushState({}, "", "/codex/tasks/task_e_test");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("injects Download Patch exactly once", async () => {
    document.body.innerHTML = `
      <button aria-label="Open git action menu">menu</button>
      <div role="menu">
        <div role="menuitem"><span>Copy Git Apply</span></div>
        <div role="menuitem"><span>Create Draft PR</span></div>
      </div>
    `;

    const handle = initDownloadPatchMenuItemFeature(makeTestContext());
    const trigger = document.querySelector(
      'button[aria-label="Open git action menu"]'
    ) as HTMLButtonElement;

    trigger.click();
    await flush();

    let labels = Array.from(document.querySelectorAll('[role="menuitem"]')).map(
      (el) => el.textContent?.trim() ?? ""
    );
    expect(labels.filter((text) => text === "Download Patch")).toHaveLength(1);

    trigger.click();
    await flush();

    labels = Array.from(document.querySelectorAll('[role="menuitem"]')).map(
      (el) => el.textContent?.trim() ?? ""
    );
    expect(labels.filter((text) => text === "Download Patch")).toHaveLength(1);

    handle.dispose();
  });

  it("clicking Download Patch captures clipboard text over bridge and asks background to download", async () => {
    document.body.innerHTML = `
      <h1>My Task Title</h1>
      <button aria-label="Open git action menu">menu</button>
      <div role="menu">
        <div role="menuitem" id="copy-item"><span>Copy Git Apply</span></div>
        <div role="menuitem"><span>Create Draft PR</span></div>
      </div>
    `;

    const expectedPatch = "diff --git a/file b/file\n+hello\n";
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    const copySource = document.getElementById("copy-item") as HTMLElement;
    copySource.addEventListener("click", () => {
      void navigator.clipboard.writeText(expectedPatch);
    });

    const originalPostMessage = window.postMessage.bind(window);
    const postMessageSpy = vi
      .spyOn(window, "postMessage")
      .mockImplementation((message: unknown, options?: string | WindowPostMessageOptions) => {
        const data = message as { source?: string; type?: string; id?: string };
        if (data.source === "qqrm-clipboard-hook" && data.type === "begin" && data.id) {
          window.dispatchEvent(
            new MessageEvent("message", {
              source: window,
              data: {
                source: "qqrm-clipboard-hook",
                type: "captured",
                id: data.id,
                text: expectedPatch,
                transport: "writeText"
              }
            })
          );
        }
        if (typeof options === "string") {
          return originalPostMessage(message, options);
        }
        return originalPostMessage(message, options);
      });

    const sendMessageMock = vi.fn(
      (_message: unknown, callback: (response: { ok: boolean; downloadId?: number }) => void) => {
        callback({ ok: true, downloadId: 42 });
      }
    );
    (
      globalThis as typeof globalThis & {
        chrome?: { runtime?: { sendMessage?: typeof sendMessageMock; lastError?: Error } };
      }
    ).chrome = {
      runtime: {
        sendMessage: sendMessageMock
      }
    };

    const handle = initDownloadPatchMenuItemFeature(makeTestContext());

    try {
      const trigger = document.querySelector(
        'button[aria-label="Open git action menu"]'
      ) as HTMLButtonElement;

      trigger.click();
      await flush();

      const downloadItem = findDownloadMenuItem();

      expect(downloadItem).toBeTruthy();
      downloadItem?.click();
      await flush();

      expect(writeText).toHaveBeenCalledWith(expectedPatch);
      expect(postMessageSpy).toHaveBeenCalled();
      expect(sendMessageMock).toHaveBeenCalledOnce();
      const message = sendMessageMock.mock.calls[0][0] as {
        type: string;
        filename: string;
        text: string;
      };

      expect(message.type).toBe("downloadPatch");
      expect(message.filename.endsWith(".patch")).toBe(true);
      expect(message.text).toBe(expectedPatch);
    } finally {
      handle.dispose();
      delete (
        globalThis as typeof globalThis & {
          chrome?: unknown;
        }
      ).chrome;
    }
  });

  it("falls back to DOM full patch when clipboard capture is invalid", async () => {
    document.body.innerHTML = `
      <button aria-label="Open git action menu">menu</button>
      <div role="menu">
        <div role="menuitem" id="copy-item"><span>Copy Patch</span></div>
      </div>
      <pre id="patch-block">diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-old
+new
</pre>
    `;

    const originalPostMessage = window.postMessage.bind(window);
    vi.spyOn(window, "postMessage").mockImplementation(
      (message: unknown, options?: string | WindowPostMessageOptions) => {
        const data = message as { source?: string; type?: string; id?: string };
        if (data.source === "qqrm-clipboard-hook" && data.type === "begin" && data.id) {
          window.dispatchEvent(
            new MessageEvent("message", {
              source: window,
              data: {
                source: "qqrm-clipboard-hook",
                type: "captured",
                id: data.id,
                text: "Copied patch to clipboard",
                transport: "copy-event"
              }
            })
          );
        }
        if (typeof options === "string") {
          return originalPostMessage(message, options);
        }
        return originalPostMessage(message, options);
      }
    );

    const sendMessageMock = vi.fn(
      (_message: unknown, callback: (response: { ok: true; downloadId: number }) => void) => {
        callback({ ok: true, downloadId: 12 });
      }
    );
    (
      globalThis as typeof globalThis & {
        chrome?: { runtime?: { sendMessage?: typeof sendMessageMock; lastError?: Error } };
      }
    ).chrome = { runtime: { sendMessage: sendMessageMock } };

    const handle = initDownloadPatchMenuItemFeature(makeTestContext());

    try {
      (
        document.querySelector('button[aria-label="Open git action menu"]') as HTMLButtonElement
      ).click();
      await flush();

      findDownloadMenuItem()?.click();
      await flush();

      expect(sendMessageMock).toHaveBeenCalledOnce();
      const message = sendMessageMock.mock.calls[0][0] as { text: string };
      expect(message.text).toContain("diff --git a/a.ts b/a.ts");
      expect(message.text).not.toContain("Copied patch to clipboard");
    } finally {
      handle.dispose();
      delete (globalThis as typeof globalThis & { chrome?: unknown }).chrome;
    }
  });

  it("shows an alert when background times out in chrome callback branch", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <button aria-label="Open git action menu">menu</button>
      <div role="menu">
        <div role="menuitem"><span>Copy Patch</span></div>
      </div>
    `;

    const patchText = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-a\n+b\n";
    const originalPostMessage = window.postMessage.bind(window);
    vi.spyOn(window, "postMessage").mockImplementation(
      (message: unknown, options?: string | WindowPostMessageOptions) => {
        const data = message as { source?: string; type?: string; id?: string };
        if (data.source === "qqrm-clipboard-hook" && data.type === "begin" && data.id) {
          window.dispatchEvent(
            new MessageEvent("message", {
              source: window,
              data: {
                source: "qqrm-clipboard-hook",
                type: "captured",
                id: data.id,
                text: patchText,
                transport: "writeText"
              }
            })
          );
        }
        if (typeof options === "string") {
          return originalPostMessage(message, options);
        }
        return originalPostMessage(message, options);
      }
    );

    const sendMessageMock = vi.fn((_message: unknown, _callback: (response?: unknown) => void) => {
      // never resolve callback
    });
    (
      globalThis as typeof globalThis & {
        chrome?: { runtime?: { sendMessage?: typeof sendMessageMock; lastError?: Error } };
      }
    ).chrome = { runtime: { sendMessage: sendMessageMock } };

    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const handle = initDownloadPatchMenuItemFeature(makeTestContext());

    try {
      (
        document.querySelector('button[aria-label="Open git action menu"]') as HTMLButtonElement
      ).click();
      await vi.runAllTimersAsync();

      findDownloadMenuItem()?.click();
      await vi.advanceTimersByTimeAsync(10050);

      expect(sendMessageMock).toHaveBeenCalledOnce();
      expect(alertSpy).toHaveBeenCalledWith("Download failed: Background timeout");
    } finally {
      handle.dispose();
      delete (globalThis as typeof globalThis & { chrome?: unknown }).chrome;
    }
  });

  it("prevents duplicate concurrent downloads on rapid clicks", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <button aria-label="Open git action menu">menu</button>
      <div role="menu">
        <div role="menuitem"><span>Copy Patch</span></div>
      </div>
    `;

    const patchText = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-a\n+b\n";
    const originalPostMessage = window.postMessage.bind(window);
    vi.spyOn(window, "postMessage").mockImplementation(
      (message: unknown, options?: string | WindowPostMessageOptions) => {
        const data = message as { source?: string; type?: string; id?: string };
        if (data.source === "qqrm-clipboard-hook" && data.type === "begin" && data.id) {
          window.setTimeout(() => {
            window.dispatchEvent(
              new MessageEvent("message", {
                source: window,
                data: {
                  source: "qqrm-clipboard-hook",
                  type: "captured",
                  id: data.id,
                  text: patchText,
                  transport: "writeText"
                }
              })
            );
          }, 25);
        }
        if (typeof options === "string") {
          return originalPostMessage(message, options);
        }
        return originalPostMessage(message, options);
      }
    );

    const sendMessageMock = vi.fn(
      (_message: unknown, callback: (response: { ok: true; downloadId: number }) => void) => {
        window.setTimeout(() => callback({ ok: true, downloadId: 5 }), 25);
      }
    );
    (
      globalThis as typeof globalThis & {
        chrome?: { runtime?: { sendMessage?: typeof sendMessageMock; lastError?: Error } };
      }
    ).chrome = { runtime: { sendMessage: sendMessageMock } };

    const handle = initDownloadPatchMenuItemFeature(makeTestContext());

    try {
      (
        document.querySelector('button[aria-label="Open git action menu"]') as HTMLButtonElement
      ).click();
      await vi.runAllTimersAsync();

      const item = findDownloadMenuItem();
      item?.click();
      item?.click();

      await vi.advanceTimersByTimeAsync(100);
      expect(sendMessageMock).toHaveBeenCalledOnce();
    } finally {
      handle.dispose();
      delete (globalThis as typeof globalThis & { chrome?: unknown }).chrome;
    }
  });

  it("rejects non-patch clipboard text without fallback", async () => {
    document.body.innerHTML = `
      <button aria-label="Open git action menu">menu</button>
      <div role="menu">
        <div role="menuitem"><span>Copy Patch</span></div>
      </div>
    `;

    const originalPostMessage = window.postMessage.bind(window);
    vi.spyOn(window, "postMessage").mockImplementation(
      (message: unknown, options?: string | WindowPostMessageOptions) => {
        const data = message as { source?: string; type?: string; id?: string };
        if (data.source === "qqrm-clipboard-hook" && data.type === "begin" && data.id) {
          window.dispatchEvent(
            new MessageEvent("message", {
              source: window,
              data: {
                source: "qqrm-clipboard-hook",
                type: "captured",
                id: data.id,
                text: "Copied patch to clipboard",
                transport: "copy-event"
              }
            })
          );
        }
        if (typeof options === "string") {
          return originalPostMessage(message, options);
        }
        return originalPostMessage(message, options);
      }
    );

    const sendMessageMock = vi.fn();
    (
      globalThis as typeof globalThis & {
        chrome?: { runtime?: { sendMessage?: typeof sendMessageMock; lastError?: Error } };
      }
    ).chrome = { runtime: { sendMessage: sendMessageMock } };

    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const handle = initDownloadPatchMenuItemFeature(makeTestContext());

    try {
      (
        document.querySelector('button[aria-label="Open git action menu"]') as HTMLButtonElement
      ).click();
      await flush();

      findDownloadMenuItem()?.click();
      await flush();

      expect(sendMessageMock).not.toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalledWith(
        "Download failed: Unable to capture patch content (clipboard and DOM fallback failed)."
      );
    } finally {
      handle.dispose();
      delete (globalThis as typeof globalThis & { chrome?: unknown }).chrome;
    }
  });
});
