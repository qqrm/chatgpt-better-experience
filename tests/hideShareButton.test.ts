import { afterEach, describe, expect, it } from "vitest";
import { initHideShareButtonFeature } from "../src/features/hideShareButton";
import { makeTestContext } from "./helpers/testContext";

describe("hideShareButton", () => {
  afterEach(() => {
    document.head.innerHTML = "";
  });

  it("installs and removes its scoped style when the setting changes", () => {
    const ctx = makeTestContext({ hideShareButton: true });
    const handle = initHideShareButtonFeature(ctx);

    expect(document.querySelector("#qqrm-hide-share-button-style")).not.toBeNull();

    const previous = { ...ctx.settings };
    ctx.settings.hideShareButton = false;
    handle.onSettingsChange?.(ctx.settings, previous);

    expect(document.querySelector("#qqrm-hide-share-button-style")).toBeNull();
    handle.dispose();
  });
});
