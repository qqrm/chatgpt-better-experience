import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOneClickDeleteStyleText,
  directArchiveConversationFromRow,
  directDeleteConversationFromRow,
  extractConversationIdFromRow,
  getAccessToken,
  patchConversation,
  initOneClickDeleteFeature
} from "../../src/features/oneClickDelete";
import { SETTINGS_DEFAULTS, Settings } from "../../src/domain/settings";
import { FeatureContext } from "../../src/application/featureContext";
import { StoragePort } from "../../src/domain/ports/storagePort";

const createContext = (overrides: Partial<Settings> = {}): FeatureContext => {
  const settings = { ...SETTINGS_DEFAULTS, ...overrides };
  const storagePort: StoragePort = {
    get: <T extends Record<string, unknown>>(defaults: T) => Promise.resolve(defaults),
    set: () => Promise.resolve()
  };

  return {
    settings,
    storagePort,
    logger: { isEnabled: false, debug: () => {} },
    keyState: { shift: false, ctrl: false, alt: false },
    helpers: {
      waitPresent: () => Promise.resolve(null),
      waitGone: () => Promise.resolve(true),
      humanClick: (el) => {
        if (!el) return false;
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return true;
      },
      debounceScheduler: (fn, delayMs) => {
        let timeoutId: number | null = null;
        return {
          schedule: () => {
            if (timeoutId !== null) window.clearTimeout(timeoutId);
            timeoutId = window.setTimeout(fn, delayMs);
          },
          cancel: () => {
            if (timeoutId !== null) window.clearTimeout(timeoutId);
            timeoutId = null;
          }
        };
      },
      safeQuery: (sel, root = document) => root.querySelector(sel)
    }
  };
};

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("one-click delete styles", () => {
  it("targets only the options icon svg for absolute positioning", () => {
    const cssText = buildOneClickDeleteStyleText();
    const selector = 'button[data-testid^="history-item-"][data-testid$="-options"]';

    expect(cssText).toContain(`${selector} svg[data-qqrm-native-dots="1"]{`);
    expect(cssText).not.toContain(`${selector} > svg{`);
  });

  it("adds delete and archive buttons, then cleans up on dispose", () => {
    const ctx = createContext({ oneClickDelete: true });

    const row = document.createElement("div");
    row.className = "group __menu-item hoverable";
    const btn = document.createElement("button");
    btn.setAttribute("data-testid", "history-item-1-options");
    btn.innerHTML = `<svg></svg>`;
    row.appendChild(btn);
    document.body.appendChild(row);

    const feature = initOneClickDeleteFeature(ctx);

    expect(btn.querySelector('span[data-qqrm-oneclick-del-x="1"]')).not.toBeNull();
    expect(btn.querySelector('span[data-qqrm-oneclick-archive="1"]')).not.toBeNull();
    expect(btn.querySelector('svg[data-qqrm-native-dots="1"]')).not.toBeNull();
    expect(document.getElementById("cgptbe-silent-delete-style")).not.toBeNull();

    feature.dispose();

    expect(btn.querySelector('span[data-qqrm-oneclick-del-x="1"]')).toBeNull();
    expect(btn.querySelector('span[data-qqrm-oneclick-archive="1"]')).toBeNull();
    expect(btn.querySelector('svg[data-qqrm-native-dots="1"]')).toBeNull();
    expect(document.getElementById("cgptbe-silent-delete-style")).toBeNull();
  });

  it("shows and cancels pending overlay on delete click", () => {
    vi.useFakeTimers();
    const ctx = createContext({ oneClickDelete: true });

    const row = document.createElement("div");
    row.className = "group __menu-item hoverable";
    const btn = document.createElement("button");
    btn.setAttribute("data-testid", "history-item-1-options");
    btn.innerHTML = `<svg></svg>`;
    row.appendChild(btn);
    document.body.appendChild(row);

    const feature = initOneClickDeleteFeature(ctx);
    const x = btn.querySelector('span[data-qqrm-oneclick-del-x="1"]');
    const Pointer = window.PointerEvent ?? MouseEvent;
    x?.dispatchEvent(new Pointer("pointerdown", { bubbles: true }));

    const overlay = row.querySelector(".qqrm-oneclick-undo-overlay");
    expect(overlay).not.toBeNull();

    overlay?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(row.querySelector(".qqrm-oneclick-undo-overlay")).toBeNull();

    feature.dispose();
  });
});

describe("one-click delete direct patch helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("extracts conversation id from rows", () => {
    const row = document.createElement("div");
    const link = document.createElement("a");
    link.setAttribute("href", "/c/abc123");
    row.appendChild(link);

    expect(extractConversationIdFromRow(row)).toBe("abc123");

    link.setAttribute("href", "/c/abc123?foo=1");
    expect(extractConversationIdFromRow(row)).toBe("abc123");

    link.setAttribute("href", "https://chatgpt.com/c/abs456?bar=2");
    expect(extractConversationIdFromRow(row)).toBe("abs456");

    row.innerHTML = "";
    expect(extractConversationIdFromRow(row)).toBeNull();
  });

  it("returns access token when session endpoint responds with token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ accessToken: "t" })
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAccessToken()).resolves.toBe("t");
  });

  it("returns null when session endpoint has no token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({})
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAccessToken()).resolves.toBeNull();
  });

  it("returns null when session endpoint fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAccessToken()).resolves.toBeNull();
  });

  it("patches conversations with required headers and device id", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo, init?: RequestInit) => {
      if (input === "/api/auth/session?unstable_client=true") {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ accessToken: "token-value" })
        };
      }

      return { ok: true, init };
    });
    vi.stubGlobal("fetch", fetchMock);

    localStorage.setItem("oai-device-id", "device-123");

    const ok = await patchConversation("conv123", { is_visible: false });

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/backend-api/conversation/conv123",
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
        body: JSON.stringify({ is_visible: false })
      })
    );

    const init = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer token-value");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["oai-device-id"]).toBe("device-123");
  });

  it("returns false when patch response is not ok", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo) => {
      if (input === "/api/auth/session?unstable_client=true") {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ accessToken: "token-value" })
        };
      }

      return { ok: false };
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(patchConversation("conv123", { is_visible: false })).resolves.toBe(false);
  });

  it("removes rows on direct delete without silent mode", async () => {
    const row = document.createElement("div");
    row.className = "group __menu-item hoverable";
    const btn = document.createElement("button");
    btn.setAttribute("data-testid", "history-item-1-options");
    const link = document.createElement("a");
    link.setAttribute("href", "/c/conv_123");
    row.appendChild(btn);
    row.appendChild(link);
    document.body.appendChild(row);

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo) => {
      if (input === "/api/auth/session?unstable_client=true") {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ accessToken: "t" })
        };
      }

      return { ok: true };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await directDeleteConversationFromRow(row);

    expect(result.ok).toBe(true);
    expect(result.attempted).toBe(true);
    expect(document.body.contains(row)).toBe(false);
    expect(document.documentElement.getAttribute("data-cgptbe-silent-delete")).toBeNull();
  });

  it("removes rows on direct archive without silent mode", async () => {
    const row = document.createElement("div");
    row.className = "group __menu-item hoverable";
    const link = document.createElement("a");
    link.setAttribute("href", "/c/conv_456");
    row.appendChild(link);
    document.body.appendChild(row);

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo) => {
      if (input === "/api/auth/session?unstable_client=true") {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ accessToken: "t" })
        };
      }

      return { ok: true };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await directArchiveConversationFromRow(row);

    expect(result.ok).toBe(true);
    expect(result.attempted).toBe(true);
    expect(document.body.contains(row)).toBe(false);
    expect(document.documentElement.getAttribute("data-cgptbe-silent-delete")).toBeNull();
  });
});
