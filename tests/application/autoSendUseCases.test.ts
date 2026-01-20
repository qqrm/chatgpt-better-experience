import { describe, expect, it } from "vitest";
import { decideAutoSend } from "../../src/application/autoSendUseCases";

describe("decideAutoSend", () => {
  it("sends when auto-send is enabled and modifier is not held", () => {
    const decision = decideAutoSend({ autoSendEnabled: true, heldDuring: false });
    expect(decision.shouldSend).toBe(true);
  });

  it("skips send when auto-send is enabled but modifier is held", () => {
    const decision = decideAutoSend({ autoSendEnabled: true, heldDuring: true });
    expect(decision.shouldSend).toBe(false);
  });

  it("skips send when auto-send is disabled", () => {
    const decision = decideAutoSend({ autoSendEnabled: false, heldDuring: false });
    expect(decision.shouldSend).toBe(false);
  });
});
