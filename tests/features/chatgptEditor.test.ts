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
    Object.defineProperty(save, "offsetParent", { value: document.body });

    form.appendChild(textarea);
    form.appendChild(save);
    document.body.appendChild(form);

    const found = findEditSubmitButton(textarea);
    expect(found).toBe(save);
  });

  it("finds a Send button inside edit forms even when type=submit is missing", () => {
    const form = document.createElement("form");
    const textarea = document.createElement("textarea");

    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    Object.defineProperty(cancel, "offsetParent", { value: document.body });

    const send = document.createElement("button");
    send.textContent = "Send";
    // Important: ChatGPT edit UI can use a plain button without type=submit.
    Object.defineProperty(send, "offsetParent", { value: document.body });

    form.appendChild(textarea);
    form.appendChild(cancel);
    form.appendChild(send);
    document.body.appendChild(form);

    const found = findEditSubmitButton(textarea);
    expect(found).toBe(send);
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

  it("supports role=button edit apply controls", () => {
    const container = document.createElement("div");
    const textarea = document.createElement("textarea");
    container.appendChild(textarea);

    const apply = document.createElement("div");
    apply.setAttribute("role", "button");
    apply.setAttribute("aria-label", "Apply");
    Object.defineProperty(apply, "offsetParent", { value: container });
    container.appendChild(apply);

    document.body.appendChild(container);

    const found = findEditSubmitButton(textarea);
    expect(found).toBe(apply);
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
