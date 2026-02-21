export {};

declare global {
  interface Window {
    __tmTranscribeHookInstalled__?: boolean;
  }
}

(() => {
  if (window.__tmTranscribeHookInstalled__) return;
  window.__tmTranscribeHookInstalled__ = true;

  const SOURCE =
    document.currentScript instanceof HTMLScriptElement
      ? document.currentScript.dataset.source || "tm-dictation-transcribe"
      : "tm-dictation-transcribe";

  const isTranscribeUrl = (url: string) => url.includes("/backend-api/transcribe");

  let seq = 0;
  const xhrIds = new WeakMap<XMLHttpRequest, string>();
  const post = (payload: { type: "start" | "complete"; id: string }) => {
    try {
      window.postMessage({ source: SOURCE, ...payload }, "*");
    } catch (_) {}
  };

  const getUrl = (input: RequestInfo | URL) => {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.toString();
    if (input instanceof Request) return input.url;
    if (input && typeof (input as Request).url === "string") return (input as Request).url;
    return "";
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = getUrl(input);
    if (!isTranscribeUrl(url)) return originalFetch(input, init);
    const id = `f${++seq}`;
    post({ type: "start", id });
    return originalFetch(input, init).then((resp) => {
      post({ type: "complete", id });
      return resp;
    });
  };

  const OriginalXHR = window.XMLHttpRequest;
  function HookedXMLHttpRequest() {
    const xhr = new OriginalXHR();
    let url = "";
    const open = xhr.open.bind(xhr);
    xhr.open = function (
      method: string,
      urlArg: string,
      async?: boolean,
      username?: string | null,
      password?: string | null
    ) {
      url = String(urlArg || "");
      if (isTranscribeUrl(url)) {
        const id = `x${++seq}`;
        xhrIds.set(xhr, id);
        post({ type: "start", id });
      }
      return open(method, urlArg, async ?? true, username ?? null, password ?? null);
    };
    xhr.addEventListener("loadend", () => {
      if (!isTranscribeUrl(url)) return;
      const id = xhrIds.get(xhr);
      if (id) {
        xhrIds.delete(xhr);
        post({ type: "complete", id });
      }
    });
    return xhr;
  }
  HookedXMLHttpRequest.prototype = OriginalXHR.prototype;
  window.XMLHttpRequest = HookedXMLHttpRequest as unknown as typeof XMLHttpRequest;
})();
