"use strict";
var cgptBetterExp = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/pageTranscribeHook.ts
  var pageTranscribeHook_exports = {};
  (() => {
    if (window.__tmTranscribeHookInstalled__) return;
    window.__tmTranscribeHookInstalled__ = true;
    const SOURCE = document.currentScript instanceof HTMLScriptElement ? document.currentScript.dataset.source || "tm-dictation-transcribe" : "tm-dictation-transcribe";
    const isTranscribeUrl = (url) => url.includes("/backend-api/transcribe");
    let seq = 0;
    const xhrIds = /* @__PURE__ */ new WeakMap();
    const post = (payload) => {
      try {
        window.postMessage({ source: SOURCE, ...payload }, "*");
      } catch {
      }
    };
    const getUrl = (input) => {
      if (typeof input === "string") return input;
      if (input instanceof URL) return input.toString();
      if (input instanceof Request) return input.url;
      if (input && typeof input.url === "string") return input.url;
      return "";
    };
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
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
      xhr.open = function(method, urlArg, async, username, password) {
        url = String(urlArg || "");
        if (isTranscribeUrl(url)) {
          const id = `x${++seq}`;
          xhrIds.set(xhr, id);
          post({ type: "start", id });
        }
        return open(method, urlArg, async != null ? async : true, username != null ? username : null, password != null ? password : null);
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
    window.XMLHttpRequest = HookedXMLHttpRequest;
  })();
  return __toCommonJS(pageTranscribeHook_exports);
})();
//# sourceMappingURL=pageTranscribeHook.js.map
