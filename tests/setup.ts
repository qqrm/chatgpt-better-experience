// JSDOM is missing several browser APIs that our content scripts rely on.
// Keep this file minimal and deterministic.

type GlobalWithPointerEvent = typeof globalThis & {
  PointerEvent?: typeof PointerEvent;
};

type PointerEventInitLike = MouseEventInit & {
  pointerId?: number;
  pointerType?: string;
  isPrimary?: boolean;
};

const g = globalThis as GlobalWithPointerEvent;

// PointerEvent polyfill (enough for dispatchEvent usage)
if (typeof g.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    isPrimary: boolean;

    constructor(type: string, init: PointerEventInitLike = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? "mouse";
      this.isPrimary = init.isPrimary ?? true;
    }
  }

  // TS lib.dom defines PointerEvent as a global type, but JSDOM doesn't provide it.
  g.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

// Make visibility helpers deterministic: give elements a non-zero client rect by default.
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function getBoundingClientRectPatched(): DOMRect {
  const r = originalGetBoundingClientRect.call(this);
  if (r && (r.width > 0 || r.height > 0)) return r;

  // DOMRect is available in JSDOM; if not, this still satisfies the DOMRect shape we use.
  const rectLike: DOMRect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 10,
    bottom: 10,
    width: 10,
    height: 10,
    toJSON() {
      return {};
    }
  } as DOMRect;

  return rectLike;
};

// scrollIntoView is not implemented in JSDOM.
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}
