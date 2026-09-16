import { describe, expect, it, vi } from "vitest";
import type { RootSnapshot } from "../src/application/domEventBus";
import {
  buildOneClickDeleteStyleText,
  createPendingOverlayContent,
  createQuickIconSvg,
  initOneClickDeleteFeature
} from "../src/features/oneClickDelete";
import { makeTestContext } from "./helpers/testContext";

describe("oneClickDelete DOM builders", () => {
  it("builds quick action icons without HTML string insertion", () => {
    const icons = [createQuickIconSvg("delete"), createQuickIconSvg("archive")];

    for (const icon of icons) {
      expect(icon.tagName.toLowerCase()).toBe("svg");
      expect(icon.getAttribute("aria-hidden")).toBe("true");
      expect(icon.querySelector("script")).toBeNull();
      expect(icon.querySelectorAll("path").length).toBeGreaterThan(0);
    }
  });

  it("builds pending overlay content as DOM nodes", () => {
    const host = document.createElement("div");
    host.append(createPendingOverlayContent());

    expect(Array.from(host.children).map((child) => child.className)).toEqual([
      "qqrm-oneclick-wipe",
      "qqrm-oneclick-heat",
      "qqrm-oneclick-undo-label"
    ]);
    expect(host.querySelector(".qqrm-oneclick-undo-label")?.textContent).toBe("Undo");
    expect(host.querySelector("script")).toBeNull();
  });

  it("renders quick buttons before a nav root has been discovered", () => {
    document.body.innerHTML = `
      <nav class="group/scrollport">
        <ul>
          <li>
            <a class="group __menu-item hoverable" href="/c/current-chat">
              <div class="trailing highlight">
                <button data-testid="history-item-0-pin" type="button" aria-label="Pin chat"><svg></svg></button>
                <button data-testid="history-item-0-options" type="button"><svg></svg></button>
              </div>
            </a>
          </li>
        </ul>
      </nav>
    `;

    const ctx = makeTestContext({ oneClickDelete: true });
    ctx.domBus = null;
    const handle = initOneClickDeleteFeature(ctx);
    const optionsButton = document.querySelector<HTMLButtonElement>(
      'button[data-testid="history-item-0-options"]'
    );

    expect(optionsButton).not.toBeNull();
    expect(optionsButton?.getAttribute("data-qqrm-oneclick-del-hooked")).toBe("1");
    expect(
      document
        .querySelector('button[data-testid="history-item-0-pin"]')
        ?.getAttribute("data-qqrm-oneclick-native-pin")
    ).toBe("1");
    const actions = optionsButton?.previousElementSibling;
    expect(actions?.getAttribute("data-qqrm-oneclick-actions")).toBe("1");
    expect(actions?.querySelector('button[data-qqrm-oneclick-archive="1"]')).not.toBeNull();
    expect(actions?.querySelector('button[data-qqrm-oneclick-del-x="1"]')).not.toBeNull();
    expect(optionsButton?.querySelector('[data-qqrm-oneclick-archive="1"]')).toBeNull();
    expect(optionsButton?.querySelector('[data-qqrm-oneclick-del-x="1"]')).toBeNull();
    expect(buildOneClickDeleteStyleText()).toContain('[data-qqrm-oneclick-actions="1"]');
    expect(buildOneClickDeleteStyleText()).toContain('[data-qqrm-oneclick-native-pin="1"]');
    expect(buildOneClickDeleteStyleText()).not.toContain("inset-inline-start");
    expect(buildOneClickDeleteStyleText()).toContain('[data-qqrm-oneclick-del-hooked="1"]');
    expect(buildOneClickDeleteStyleText()).not.toContain("width: 150px");

    handle.dispose();
  });

  it("normalizes quick actions for a pinned chat row", () => {
    document.body.innerHTML = `
      <nav class="group/scrollport">
        <ul>
          <li>
            <a class="group __menu-item hoverable" href="/c/pinned-chat">
              <div class="trailing highlight">
                <div class="flex items-center gap-2">
                  <button type="button" aria-label="Unpin chat"><svg></svg></button>
                  <button data-testid="undefined-options" type="button"><svg></svg></button>
                </div>
              </div>
            </a>
          </li>
        </ul>
      </nav>
    `;

    const ctx = makeTestContext({ oneClickDelete: true });
    ctx.domBus = null;
    const handle = initOneClickDeleteFeature(ctx);
    const optionsButton = document.querySelector<HTMLButtonElement>(
      'button[data-testid="undefined-options"]'
    );

    expect(optionsButton?.getAttribute("data-qqrm-oneclick-del-hooked")).toBe("1");
    expect(
      document
        .querySelector('button[aria-label="Unpin chat"]')
        ?.getAttribute("data-qqrm-oneclick-native-pin")
    ).toBe("1");
    expect(optionsButton?.previousElementSibling?.getAttribute("data-qqrm-oneclick-actions")).toBe(
      "1"
    );
    expect(optionsButton?.previousElementSibling?.previousElementSibling).toBe(
      document.querySelector('button[aria-label="Unpin chat"]')
    );

    handle.dispose();
  });

  it("hooks quick actions immediately when the sidebar root appears", () => {
    document.body.innerHTML = "";

    const ctx = makeTestContext({ oneClickDelete: true });
    const domBus = ctx.domBus;
    if (!domBus) throw new Error("Expected a DOM bus");

    let rootsListener: ((roots: RootSnapshot) => void) | null = null;
    ctx.domBus = {
      ...domBus,
      getNavRoot: () => null,
      onRoots: (listener) => {
        rootsListener = listener;
        return () => {
          if (rootsListener === listener) rootsListener = null;
        };
      }
    };

    const handle = initOneClickDeleteFeature(ctx);
    document.body.innerHTML = `
      <nav>
        <a class="group __menu-item hoverable" href="/c/pinned-chat">
          <div class="trailing highlight">
            <button type="button" aria-label="Pin chat"><svg></svg></button>
            <button data-testid="undefined-options" type="button"><svg></svg></button>
          </div>
        </a>
      </nav>
    `;

    const nav = document.querySelector("nav");
    const emitRoots = rootsListener as ((roots: RootSnapshot) => void) | null;
    emitRoots?.({ main: null, nav, reason: "initial" });

    expect(
      document
        .querySelector('button[data-testid="undefined-options"]')
        ?.getAttribute("data-qqrm-oneclick-del-hooked")
    ).toBe("1");

    handle.dispose();
  });

  it("hooks rows that render after start via warm-up rescans", async () => {
    vi.useFakeTimers();

    try {
      document.body.innerHTML = "";

      const ctx = makeTestContext({ oneClickDelete: true });
      ctx.domBus = null;
      const handle = initOneClickDeleteFeature(ctx);

      document.body.innerHTML = `
        <nav aria-label="Chat history">
          <ul>
            <li>
              <a class="group __menu-item hoverable" href="/c/late-chat">
                <div class="trailing highlight">
                  <div class="flex items-center gap-2">
                    <button data-testid="history-item-9-pin" type="button" aria-label="Pin chat"><svg></svg></button>
                    <button data-testid="history-item-9-options" type="button"><svg></svg></button>
                  </div>
                </div>
              </a>
            </li>
          </ul>
        </nav>
      `;

      await vi.advanceTimersByTimeAsync(1_000);

      const optionsButton = document.querySelector<HTMLElement>(
        'button[data-testid="history-item-9-options"]'
      );
      expect(optionsButton?.getAttribute("data-qqrm-oneclick-del-hooked")).toBe("1");
      expect(
        document
          .querySelector('button[data-testid="history-item-9-pin"]')
          ?.getAttribute("data-qqrm-oneclick-native-pin")
      ).toBe("1");

      handle.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not hook the native pin button even when it carries a history-item testid", () => {
    document.body.innerHTML = `
      <nav aria-label="Chat history">
        <ul>
          <li>
            <a class="group __menu-item hoverable" href="/c/live-chat">
              <div class="trailing highlight">
                <div class="flex items-center gap-2">
                  <button data-testid="history-item-0-pin" type="button" aria-label="Pin chat"><svg></svg></button>
                  <button data-testid="history-item-0-options" type="button"><svg></svg></button>
                </div>
              </div>
            </a>
          </li>
        </ul>
      </nav>
    `;

    const ctx = makeTestContext({ oneClickDelete: true });
    ctx.domBus = null;
    const handle = initOneClickDeleteFeature(ctx);

    const pin = document.querySelector<HTMLButtonElement>(
      'button[data-testid="history-item-0-pin"]'
    );

    expect(pin?.getAttribute("data-qqrm-oneclick-del-hooked")).toBeNull();
    expect(pin?.getAttribute("data-qqrm-oneclick-native-pin")).toBe("1");
    expect(document.querySelectorAll("[data-qqrm-oneclick-actions='1']").length).toBe(1);

    handle.dispose();
  });

  it("prunes orphaned quick action groups instead of stacking duplicates", () => {
    document.body.innerHTML = `
      <nav aria-label="Chat history">
        <ul>
          <li>
            <a class="group __menu-item hoverable" href="/c/rerendered-chat">
              <div class="trailing highlight">
                <div class="flex items-center gap-2">
                  <div data-qqrm-oneclick-actions="1" role="group">
                    <button data-qqrm-oneclick-archive="1" type="button"></button>
                    <button data-qqrm-oneclick-del-x="1" type="button"></button>
                  </div>
                  <button data-testid="history-item-1-options" type="button"><svg></svg></button>
                </div>
              </div>
            </a>
          </li>
        </ul>
      </nav>
    `;

    const ctx = makeTestContext({ oneClickDelete: true });
    ctx.domBus = null;
    const handle = initOneClickDeleteFeature(ctx);

    const groups = document.querySelectorAll("[data-qqrm-oneclick-actions='1']");
    expect(groups.length).toBe(1);

    const owner = groups[0].nextElementSibling;
    expect(owner?.getAttribute("data-testid")).toBe("history-item-1-options");
    expect(owner?.getAttribute("data-qqrm-oneclick-del-hooked")).toBe("1");

    handle.dispose();
  });

  it("marks a native pin button wrapped separately from the options button", () => {
    document.body.innerHTML = `
      <nav aria-label="Chat history">
        <ul>
          <li>
            <a class="group __menu-item hoverable" href="/c/wrapped-pin-chat">
              <div class="trailing highlight">
                <div class="pin-wrapper">
                  <button type="button" aria-label="Закрепить чат"><svg></svg></button>
                </div>
                <div class="options-wrapper">
                  <button data-testid="undefined-options" type="button"><svg></svg></button>
                </div>
              </div>
            </a>
          </li>
        </ul>
      </nav>
    `;

    const ctx = makeTestContext({ oneClickDelete: true });
    ctx.domBus = null;
    const handle = initOneClickDeleteFeature(ctx);

    expect(
      document
        .querySelector('button[aria-label="Закрепить чат"]')
        ?.getAttribute("data-qqrm-oneclick-native-pin")
    ).toBe("1");

    handle.dispose();
  });
});
