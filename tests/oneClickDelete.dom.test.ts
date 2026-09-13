import { describe, expect, it } from "vitest";
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
    const actions = optionsButton?.previousElementSibling;
    expect(actions?.getAttribute("data-qqrm-oneclick-actions")).toBe("1");
    expect(actions?.querySelector('button[data-qqrm-oneclick-archive="1"]')).not.toBeNull();
    expect(actions?.querySelector('button[data-qqrm-oneclick-del-x="1"]')).not.toBeNull();
    expect(optionsButton?.querySelector('[data-qqrm-oneclick-archive="1"]')).toBeNull();
    expect(optionsButton?.querySelector('[data-qqrm-oneclick-del-x="1"]')).toBeNull();
    expect(buildOneClickDeleteStyleText()).toContain('[data-qqrm-oneclick-actions="1"]');
    expect(buildOneClickDeleteStyleText()).not.toContain("width: 150px");

    handle.dispose();
  });
});
