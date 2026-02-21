import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeTestContext } from "./helpers/testContext";
import { initDownloadPatchMenuItemFeature } from "../src/features/downloadPatchMenuItem";

const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 60));
};

describe("downloadPatchMenuItem", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    history.pushState({}, "", "/codex/tasks/task_e_test");
  });

  afterEach(() => {
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
                text: expectedPatch
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

      const downloadItem = Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]')
      ).find((el) => (el.textContent ?? "").trim() === "Download Patch");

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

  it("shows an alert when background download fails", async () => {
    document.body.innerHTML = `
      <button aria-label="Open git action menu">menu</button>
      <div role="menu">
        <div role="menuitem" id="copy-item"><span>Copy Patch</span></div>
      </div>
    `;

    const patchText = "diff --git a/a b/a\n";
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
                text: patchText
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
      (_message: unknown, callback: (response: { ok: false; error: string }) => void) => {
        callback({ ok: false, error: "boom" });
      }
    );
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

      const downloadItem = Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]')
      ).find((el) => (el.textContent ?? "").trim() === "Download Patch");

      downloadItem?.click();
      await flush();

      expect(alertSpy).toHaveBeenCalledWith("Download failed: boom");
    } finally {
      handle.dispose();
      delete (
        globalThis as typeof globalThis & {
          chrome?: unknown;
        }
      ).chrome;
    }
  });
});
