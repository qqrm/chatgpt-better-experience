const STORAGE_KEY = "mock-gpt-settings-v1";
const FIXTURE_HEAD_ATTR = "data-mock-gpt-fixture-head";

const fixtureSelect = document.getElementById("fixtureSelect");
const pathInput = document.getElementById("pathInput");
const wideChatWidthInput = document.getElementById("wideChatWidthInput");
const reloadButton = document.getElementById("reloadButton");
const resetButton = document.getElementById("resetButton");
const toggleGrid = document.getElementById("toggleGrid");
const statusLine = document.getElementById("statusLine");
const fixtureHost = document.getElementById("fixtureHost");

const DEFAULT_SETTINGS = {
  autoSend: true,
  allowAutoSendInCodex: true,
  showMessageTimestamps: true,
  preserveReadingPositionOnSend: true,
  downloadGitPatchesWithShiftClick: true,
  clearClipboardAfterShiftDownload: false,
  editLastMessageOnArrowUp: true,
  renameChatOnF2: true,
  autoExpandChats: true,
  autoExpandProjects: true,
  autoExpandProjectItems: false,
  autoTempChat: false,
  tempChatEnabled: false,
  oneClickDelete: true,
  startDictation: false,
  ctrlEnterSends: true,
  wideChatWidth: 0,
  trimChatDom: false,
  trimChatDomKeep: 10,
  hideShareButton: false,
  macroRecorderEnabled: false,
  debugAutoExpandProjects: false,
  debugTraceTarget: "projects"
};

const TOGGLES = [
  ["autoSend", "Auto Send"],
  ["allowAutoSendInCodex", "Allow In Codex"],
  ["showMessageTimestamps", "Timestamps"],
  ["preserveReadingPositionOnSend", "Preserve Scroll"],
  ["editLastMessageOnArrowUp", "Arrow Up Edit"],
  ["renameChatOnF2", "Rename On F2"],
  ["autoExpandChats", "Expand Chats"],
  ["autoExpandProjects", "Expand Projects"],
  ["autoExpandProjectItems", "Expand Project Items"],
  ["oneClickDelete", "One Click Delete"],
  ["ctrlEnterSends", "Ctrl+Enter Sends"],
  ["trimChatDom", "Trim Chat DOM"],
  ["hideShareButton", "Hide Share"],
  ["debugAutoExpandProjects", "Debug Traces"]
];

function getSearchParams() {
  return new URLSearchParams(window.location.search);
}

function loadStoredSettings() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveStoredSettings(next) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function createToggleControl(key, label, settings) {
  const wrapper = document.createElement("div");
  wrapper.className = "mockToggle";

  const title = document.createElement("span");
  title.textContent = label;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = Boolean(settings[key]);
  checkbox.dataset.settingKey = key;

  const checkboxLabel = document.createElement("label");
  checkboxLabel.append(checkbox, document.createTextNode("Enabled"));

  wrapper.append(title, checkboxLabel);
  return wrapper;
}

function installToggleControls(settings) {
  toggleGrid.replaceChildren(
    ...TOGGLES.map(([key, label]) => createToggleControl(key, label, settings))
  );
}

function collectSettingsFromControls() {
  const next = { ...loadStoredSettings() };
  for (const checkbox of Array.from(toggleGrid.querySelectorAll("input[type='checkbox']"))) {
    next[checkbox.dataset.settingKey] = checkbox.checked;
  }
  next.wideChatWidth = Number(wideChatWidthInput.value || "0");
  return next;
}

function updateQuery({ fixture, path }) {
  const url = new URL(window.location.href);
  if (fixture) url.searchParams.set("fixture", fixture);
  if (path) url.searchParams.set("path", path);
  window.location.assign(url.toString());
}

function createStorageArea(state) {
  const changeListeners = new Set();

  const area = {
    async get(defaults) {
      return { ...defaults, ...state };
    },
    async set(partial) {
      const changes = {};
      for (const [key, value] of Object.entries(partial)) {
        changes[key] = { oldValue: state[key], newValue: value };
        state[key] = value;
      }
      saveStoredSettings(state);
      for (const listener of Array.from(changeListeners)) {
        listener(changes, "sync");
      }
    },
    async getLocal(defaults) {
      return { ...defaults, ...state };
    },
    async setLocal(partial) {
      await area.set(partial);
    },
    onChanged: {
      addListener(listener) {
        changeListeners.add(listener);
      },
      removeListener(listener) {
        changeListeners.delete(listener);
      }
    }
  };

  return area;
}

function installExtensionApi(settings) {
  const storageArea = createStorageArea(settings);
  const chromeApi = {
    runtime: { lastError: null },
    storage: storageArea
  };

  window.chrome = chromeApi;
  window.browser = {
    storage: storageArea
  };
}

function absolutizeUrl(value, origin) {
  if (!value || /^([a-z]+:|data:|blob:|mailto:|#)/i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `${origin}${value}`;
  try {
    return new URL(value, origin).toString();
  } catch {
    return value;
  }
}

function rewriteAssetUrls(root, origin) {
  const rewriteNode = (node) => {
    if (!(node instanceof Element)) return;
    for (const attr of ["src", "href", "poster", "xlink:href"]) {
      const value = node.getAttribute(attr);
      if (!value) continue;
      node.setAttribute(attr, absolutizeUrl(value, origin));
    }
  };

  rewriteNode(root);

  const selector = ["[src]", "[href]", "[poster]", "use[href]", "use[xlink\\:href]"].join(",");

  for (const node of Array.from(root.querySelectorAll(selector))) {
    rewriteNode(node);
  }
}

function clearFixtureHead() {
  for (const node of Array.from(document.head.querySelectorAll(`[${FIXTURE_HEAD_ATTR}]`))) {
    node.remove();
  }
}

function installFixtureHead(fixtureDoc, origin) {
  clearFixtureHead();
  for (const child of Array.from(fixtureDoc.head.children)) {
    if (!(child instanceof Element)) continue;
    const clone = child.cloneNode(true);
    if (!(clone instanceof Element)) continue;
    rewriteAssetUrls(clone, origin);
    clone.setAttribute(FIXTURE_HEAD_ATTR, "true");
    document.head.append(clone);
  }
}

function applyFixtureMeta(fixtureDoc, origin) {
  const metaNode =
    fixtureDoc.body.querySelector("[data-fixture-theme]") ||
    fixtureDoc.querySelector("[data-fixture-theme]");
  document.body.dataset.fixtureTheme = metaNode?.getAttribute("data-fixture-theme") || "dark";

  const prior = document.querySelector(".fixtureMetaBadge");
  prior?.remove();

  const badge = document.createElement("div");
  badge.className = "fixtureMetaBadge";
  badge.textContent = `origin: ${origin}`;
  document.body.append(badge);
}

async function loadCatalog() {
  const response = await fetch("/__mock-gpt/catalog.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`catalog ${response.status}`);
  return response.json();
}

async function loadFixtureDocument(fixtureId) {
  const response = await fetch(`/__mock-gpt/fixture/${encodeURIComponent(fixtureId)}`, {
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`fixture ${response.status}`);
  const html = await response.text();
  return new DOMParser().parseFromString(html, "text/html");
}

async function bootContentScript() {
  const script = document.createElement("script");
  script.src = `/dist/content.js?ts=${Date.now()}`;
  script.async = false;

  await new Promise((resolve, reject) => {
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error("content script failed to load")), {
      once: true
    });
    document.body.append(script);
  });
}

async function main() {
  const params = getSearchParams();
  const storedSettings = loadStoredSettings();
  installToggleControls(storedSettings);
  wideChatWidthInput.value = String(storedSettings.wideChatWidth || 0);

  const catalog = await loadCatalog();
  for (const fixture of catalog.fixtures) {
    const option = document.createElement("option");
    option.value = fixture.id;
    option.textContent = fixture.label;
    fixtureSelect.append(option);
  }

  const fixtureId = params.get("fixture") || catalog.defaultFixtureId;
  const fallbackRoute =
    catalog.fixtures.find((fixture) => fixture.id === fixtureId)?.route || "/c/mock-chat";
  const mockPath = params.get("path") || fallbackRoute;

  fixtureSelect.value = fixtureId || "";
  pathInput.value = mockPath;
  history.replaceState(
    {},
    "",
    `${mockPath}?fixture=${encodeURIComponent(fixtureId || "")}&path=${encodeURIComponent(mockPath)}`
  );

  const fixtureDoc = await loadFixtureDocument(fixtureId);
  const fixtureOrigin =
    fixtureDoc.querySelector('meta[name="fixture-origin"]')?.getAttribute("content") ||
    "https://chatgpt.com";

  installFixtureHead(fixtureDoc, fixtureOrigin);
  applyFixtureMeta(fixtureDoc, fixtureOrigin);

  const bodyClone = document.createElement("div");
  bodyClone.innerHTML = fixtureDoc.body.innerHTML;
  rewriteAssetUrls(bodyClone, fixtureOrigin);
  fixtureHost.replaceChildren(...Array.from(bodyClone.childNodes));

  installExtensionApi(storedSettings);
  statusLine.textContent = `Loaded ${fixtureId} at ${mockPath}`;
  await bootContentScript();

  reloadButton.addEventListener("click", () => {
    saveStoredSettings(collectSettingsFromControls());
    updateQuery({
      fixture: fixtureSelect.value,
      path: pathInput.value || fallbackRoute
    });
  });

  resetButton.addEventListener("click", () => {
    saveStoredSettings({ ...DEFAULT_SETTINGS });
    updateQuery({
      fixture: fixtureSelect.value,
      path: pathInput.value || fallbackRoute
    });
  });
}

main().catch((error) => {
  statusLine.textContent = `Harness failed: ${error instanceof Error ? error.message : String(error)}`;
  statusLine.style.color = "#fda4af";
});
