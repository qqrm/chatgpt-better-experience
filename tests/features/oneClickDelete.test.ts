import { describe, expect, it } from "vitest";
import { buildOneClickDeleteStyleText } from "../../src/features/oneClickDelete";

describe("one-click delete styles", () => {
  it("targets only the options icon svg for absolute positioning", () => {
    const cssText = buildOneClickDeleteStyleText();
    const selector = 'button[data-testid^="history-item-"][data-testid$="-options"]';

    expect(cssText).toContain(`${selector} svg[data-qqrm-native-dots="1"]{`);
    expect(cssText).not.toContain(`${selector} > svg{`);
  });
});
