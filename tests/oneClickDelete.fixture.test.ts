import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { initOneClickDeleteFeature } from "../src/features/oneClickDelete";
import { makeTestContext } from "./helpers/testContext";

const FIXTURE_PATH = "tests/fixtures/chatgpt-structure-2026-09-12.html";

const loadFixtureBody = () => {
  const html = readFileSync(FIXTURE_PATH, "utf8");
  const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = match ? match[1] : html;
};

// Pins the feature contract against the last real captured sidebar DOM, not a
// hand-written subset: the capture contains two row generations at once
// (data-testid="undefined-options" and "history-item-N-options") plus section
// headers that must stay untouched.
describe("oneClickDelete against the captured sidebar fixture", () => {
  it("hooks exactly one quick actions group onto every chat row", () => {
    loadFixtureBody();

    const ctx = makeTestContext({ oneClickDelete: true });
    ctx.domBus = null;
    const handle = initOneClickDeleteFeature(ctx);

    const rows = Array.from(document.querySelectorAll<HTMLElement>("a.group.__menu-item"));
    const chatRows = rows.filter((row) => row.querySelector('button[data-testid$="-options"]'));
    expect(rows.length).toBe(27);
    expect(chatRows.length).toBe(21);

    for (const row of chatRows) {
      const options = row.querySelector<HTMLButtonElement>('button[data-testid$="-options"]');
      expect(options?.getAttribute("data-qqrm-oneclick-del-hooked")).toBe("1");

      const groups = row.querySelectorAll('[data-qqrm-oneclick-actions="1"]');
      expect(groups.length).toBe(1);

      const groupButtons = groups[0].querySelectorAll(":scope > button");
      expect(groupButtons.length).toBe(2);
      expect(groupButtons[0].getAttribute("data-qqrm-oneclick-archive")).toBe("1");
      expect(groupButtons[1].getAttribute("data-qqrm-oneclick-del-x")).toBe("1");
      // The row's own pin control is kept visible as the first quick action
      // instead of getting a duplicate fallback pin inside the group.
      expect(groups[0].querySelector('button[data-qqrm-oneclick-pin="1"]')).toBeNull();
      const rowButtons = Array.from(row.querySelectorAll("button"));
      expect(rowButtons.some((btn) => btn.getAttribute("data-qqrm-oneclick-native-pin"))).toBe(
        true
      );

      // Row resolution must land on the anchor element itself, not on a
      // trailing button that merely carries a history-item testid.
      expect(row.getAttribute("data-qqrm-oneclick-row")).toBe("1");
    }

    const totalHooked = document.querySelectorAll(
      'button[data-qqrm-oneclick-del-hooked="1"]'
    ).length;
    expect(totalHooked).toBe(21);

    handle.dispose();
  });

  it("leaves section header rows without quick action groups", () => {
    loadFixtureBody();

    const ctx = makeTestContext({ oneClickDelete: true });
    ctx.domBus = null;
    const handle = initOneClickDeleteFeature(ctx);

    const headerRows = Array.from(
      document.querySelectorAll<HTMLElement>("a.group.__menu-item")
    ).filter((row) => !row.querySelector('button[data-testid$="-options"]'));
    expect(headerRows.length).toBeGreaterThan(0);

    for (const row of headerRows) {
      expect(row.querySelector('[data-qqrm-oneclick-actions="1"]')).toBeNull();
      expect(row.querySelector('button[data-qqrm-oneclick-del-hooked="1"]')).toBeNull();
    }

    handle.dispose();
  });
});
