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

  it("clicking Download Patch captures clipboard text over bridge and triggers download", async () => {
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

    const createObjectUrlSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation(() => "blob:patch-url");
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const anchorClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

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
      expect(createObjectUrlSpy).toHaveBeenCalledOnce();
      expect(anchorClickSpy).toHaveBeenCalledOnce();
      expect(revokeSpy).toHaveBeenCalled();

      const anchor = anchorClickSpy.mock.instances[0] as HTMLAnchorElement;
      expect(anchor.download.endsWith(".patch")).toBe(true);

      const blob = createObjectUrlSpy.mock.calls[0][0] as Blob;
      expect(await blob.text()).toBe(expectedPatch);
    } finally {
      handle.dispose();
    }
  });
});
