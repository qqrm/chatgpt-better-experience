import { describe, expect, it } from "vitest";
import { createPendingOverlayContent, createQuickIconSvg } from "../src/features/oneClickDelete";

describe("oneClickDelete DOM builders", () => {
  it("builds quick action icons without HTML string insertion", () => {
    const icons = [
      createQuickIconSvg("delete"),
      createQuickIconSvg("archive"),
      createQuickIconSvg("pin", "pin"),
      createQuickIconSvg("pin", "unpin")
    ];

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
});
