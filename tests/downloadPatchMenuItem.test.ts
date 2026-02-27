import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeTestContext } from "./helpers/testContext";
import { initDownloadPatchMenuItemFeature } from "../src/features/downloadPatchMenuItem";

const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("downloadPatchMenuItem shift-click", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    history.pushState({}, "", "/codex/tasks/task_e_test");
    document.documentElement.setAttribute("data-qqrm-clipboard-hook-installed", "1");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.documentElement.removeAttribute("data-qqrm-clipboard-hook-installed");
    delete (globalThis as typeof globalThis & { chrome?: unknown }).chrome;
  });

  it("does not inject a Download Patch menu item", async () => {
    document.body.innerHTML = `
      <button aria-label="Open git action menu">menu</button>
      <div role="menu">
        <div role="menuitem" aria-label="Copy patch"><span>Copy patch</span></div>
      </div>
    `;

    const handle = initDownloadPatchMenuItemFeature(makeTestContext());
    try {
      (
        document.querySelector('button[aria-label="Open git action menu"]') as HTMLButtonElement
      ).click();
      await flush();

      const labels = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).map(
        (item) => (item.textContent ?? "").trim()
      );
      expect(labels).toEqual(["Copy patch"]);
    } finally {
      handle.dispose();
    }
  });

  it("normal click only copies and does not download", async () => {
    document.body.innerHTML = `
      <div role="menu">
        <div role="menuitem" id="copy-item" aria-label="Copy patch"><span>Copy patch</span></div>
      </div>
    `;

    const sendMessageMock = vi.fn();
    (
      globalThis as typeof globalThis & {
        chrome?: { runtime?: { sendMessage?: typeof sendMessageMock; lastError?: Error } };
      }
    ).chrome = { runtime: { sendMessage: sendMessageMock } };

    const copySpy = vi.fn();
    document.getElementById("copy-item")?.addEventListener("click", copySpy);

    const handle = initDownloadPatchMenuItemFeature(
      makeTestContext({ downloadGitPatchesWithShiftClick: true })
    );
    try {
      (document.getElementById("copy-item") as HTMLElement).click();
      await flush();
      expect(copySpy).toHaveBeenCalledOnce();
      expect(sendMessageMock).not.toHaveBeenCalled();
    } finally {
      handle.dispose();
    }
  });

  it("shift-click captures passthrough clipboard and sends download", async () => {
    document.body.innerHTML = `
      <div role="menu">
        <div role="menuitem" id="copy-item" aria-label="Copy git apply"><span>Copy git apply</span></div>
      </div>
    `;

    const patchText = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n";
    const originalPost = window.postMessage.bind(window);
    const postSpy = vi.spyOn(window, "postMessage").mockImplementation((message, target) => {
      const data = message as { source?: string; type?: string; id?: string; mode?: string };
      if (data.source === "qqrm-clipboard-hook" && data.type === "begin" && data.id) {
        expect(data.mode).toBe("passthrough");
        window.dispatchEvent(
          new MessageEvent("message", {
            source: window,
            data: {
              source: "qqrm-clipboard-hook",
              type: "captured",
              id: data.id,
              text: patchText,
              transport: "copy-event"
            }
          })
        );
      }
      return typeof target === "string"
        ? originalPost(message, target)
        : originalPost(message, target);
    });

    const sendMessageMock = vi.fn(
      (_message: unknown, callback: (response: { ok: true; downloadId: number }) => void) => {
        callback({ ok: true, downloadId: 1 });
      }
    );
    (
      globalThis as typeof globalThis & {
        chrome?: { runtime?: { sendMessage?: typeof sendMessageMock; lastError?: Error } };
      }
    ).chrome = { runtime: { sendMessage: sendMessageMock } };

    const copySpy = vi.fn();
    const item = document.getElementById("copy-item") as HTMLElement;
    item.addEventListener("click", copySpy);

    const handle = initDownloadPatchMenuItemFeature(
      makeTestContext({ downloadGitPatchesWithShiftClick: true })
    );
    try {
      item.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
      await flush();

      expect(copySpy).toHaveBeenCalledOnce();
      expect(postSpy).toHaveBeenCalled();
      expect(sendMessageMock).toHaveBeenCalledOnce();
    } finally {
      handle.dispose();
    }
  });

  it("toggle off disables shift-click download", async () => {
    document.body.innerHTML = `
      <div role="menu">
        <div role="menuitem" id="copy-item" aria-label="Copy patch"><span>Copy patch</span></div>
      </div>
    `;

    const sendMessageMock = vi.fn();
    (
      globalThis as typeof globalThis & {
        chrome?: { runtime?: { sendMessage?: typeof sendMessageMock; lastError?: Error } };
      }
    ).chrome = { runtime: { sendMessage: sendMessageMock } };

    const handle = initDownloadPatchMenuItemFeature(
      makeTestContext({ downloadGitPatchesWithShiftClick: false })
    );
    try {
      (document.getElementById("copy-item") as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true, shiftKey: true })
      );
      await flush();
      expect(sendMessageMock).not.toHaveBeenCalled();
    } finally {
      handle.dispose();
    }
  });
});
