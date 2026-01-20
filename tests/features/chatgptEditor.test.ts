import { afterEach, describe, expect, it } from "vitest";
import { findEditSubmitButton } from "../../src/features/chatgptEditor";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("chatgpt editor helpers", () => {
  it("finds the submit button inside edit forms", () => {
    const form = document.createElement("form");
    const textarea = document.createElement("textarea");
    const save = document.createElement("button");
    save.type = "submit";
    save.textContent = "Save";

    form.appendChild(textarea);
    form.appendChild(save);
    document.body.appendChild(form);

    const found = findEditSubmitButton(textarea);
    expect(found).toBe(save);
  });

  it("prefers visible positive action buttons", () => {
    const container = document.createElement("div");
    const textarea = document.createElement("textarea");
    container.appendChild(textarea);

    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    container.appendChild(cancel);

    const save = document.createElement("button");
    save.textContent = "Save";
    Object.defineProperty(save, "offsetParent", { value: container });
    container.appendChild(save);

    document.body.appendChild(container);

    const found = findEditSubmitButton(textarea);
    expect(found).toBe(save);
  });

  it("returns null when no suitable buttons are found", () => {
    const wrapper = document.createElement("div");
    const input = document.createElement("textarea");
    wrapper.appendChild(input);
    document.body.appendChild(wrapper);

    const found = findEditSubmitButton(input);
    expect(found).toBeNull();
  });
});
