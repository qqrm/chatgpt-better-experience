import {
  AUTO_EXPAND_PROJECTS_PREFS_DEFAULTS,
  AUTO_EXPAND_PROJECTS_PREFS_KEY,
  AUTO_EXPAND_PROJECTS_REGISTRY_DEFAULTS,
  AUTO_EXPAND_PROJECTS_REGISTRY_KEY,
  AutoExpandProjectsPrefs,
  AutoExpandProjectsRegistry,
  SETTINGS_DEFAULTS,
  Settings
} from "../domain/settings";
import { StoragePort } from "../domain/ports/storagePort";
import {
  normalizeAutoExpandProjectsPrefs,
  normalizeAutoExpandProjectsRegistry,
  normalizeSettings
} from "../lib/utils";

export interface PopupStorageDeps {
  storagePort: StoragePort;
}

export interface PopupSettingsState {
  settings: Settings;
}

export interface PopupSelectiveProjectsState {
  registry: AutoExpandProjectsRegistry;
  prefs: AutoExpandProjectsPrefs;
}

export interface PopupSelectiveProjectOption {
  href: string;
  title: string;
  expanded: boolean;
  lastSeenAt: number;
  lastSeenOrder: number;
  isCurrentlyVisible: boolean;
}

export async function loadPopupSettings({ storagePort }: PopupStorageDeps) {
  const data = await storagePort.get(SETTINGS_DEFAULTS);
  const settings = normalizeSettings(data);
  return {
    settings
  } satisfies PopupSettingsState;
}

export async function loadPopupSelectiveProjects({ storagePort }: PopupStorageDeps) {
  const data = await storagePort.getLocal({
    [AUTO_EXPAND_PROJECTS_REGISTRY_KEY]: AUTO_EXPAND_PROJECTS_REGISTRY_DEFAULTS,
    [AUTO_EXPAND_PROJECTS_PREFS_KEY]: AUTO_EXPAND_PROJECTS_PREFS_DEFAULTS
  });

  return {
    registry: normalizeAutoExpandProjectsRegistry(data[AUTO_EXPAND_PROJECTS_REGISTRY_KEY]),
    prefs: normalizeAutoExpandProjectsPrefs(data[AUTO_EXPAND_PROJECTS_PREFS_KEY])
  } satisfies PopupSelectiveProjectsState;
}

export function upsertPopupSelectiveProjectPref(
  prefs: AutoExpandProjectsPrefs,
  href: string,
  expanded: boolean
): AutoExpandProjectsPrefs {
  return {
    version: prefs.version,
    expandedByHref: {
      ...prefs.expandedByHref,
      [href]: expanded
    }
  };
}

export async function savePopupSelectiveProjectsPrefs(
  { storagePort }: PopupStorageDeps,
  prefs: AutoExpandProjectsPrefs
) {
  await storagePort.setLocal({
    [AUTO_EXPAND_PROJECTS_PREFS_KEY]: prefs
  });
}

export function buildPopupSelectiveProjectOptions(
  registry: AutoExpandProjectsRegistry,
  prefs: AutoExpandProjectsPrefs
): PopupSelectiveProjectOption[] {
  const entries = Object.values(registry.entriesByHref);
  const latestLastSeenAt = entries.reduce((max, entry) => Math.max(max, entry.lastSeenAt), 0);

  return [...entries]
    .sort((left, right) => {
      const leftVisible = latestLastSeenAt > 0 && left.lastSeenAt === latestLastSeenAt;
      const rightVisible = latestLastSeenAt > 0 && right.lastSeenAt === latestLastSeenAt;

      if (leftVisible !== rightVisible) {
        return leftVisible ? -1 : 1;
      }

      if (leftVisible && rightVisible && left.lastSeenOrder !== right.lastSeenOrder) {
        return left.lastSeenOrder - right.lastSeenOrder;
      }

      if (left.lastSeenAt !== right.lastSeenAt) {
        return right.lastSeenAt - left.lastSeenAt;
      }

      return left.title.localeCompare(right.title);
    })
    .map((entry) => ({
      href: entry.href,
      title: entry.title,
      expanded: prefs.expandedByHref[entry.href] === true,
      lastSeenAt: entry.lastSeenAt,
      lastSeenOrder: entry.lastSeenOrder,
      isCurrentlyVisible: latestLastSeenAt > 0 && entry.lastSeenAt === latestLastSeenAt
    }));
}

export interface PopupSettingsInput {
  autoSend: boolean;
  allowAutoSendInCodex: boolean;
  showMessageTimestamps: boolean;
  preserveReadingPositionOnSend: boolean;
  downloadGitPatchesWithShiftClick: boolean;
  clearClipboardAfterShiftDownload: boolean;
  editLastMessageOnArrowUp: boolean;
  renameChatOnF2: boolean;
  autoExpandChats: boolean;
  autoExpandProjects: boolean;
  autoExpandProjectItems: boolean;
  autoTempChat: boolean;
  oneClickDelete: boolean;
  startDictation: boolean;
  ctrlEnterSends: boolean;
  wideChatWidth: number;
  trimChatDom: boolean;
  trimChatDomKeep: number;
  hideShareButton: boolean;
  macroRecorderEnabled: boolean;
  debugAutoExpandProjects: boolean;
  debugTraceTarget: "projects" | "editMessage" | "autoSend" | "timestamps";
}

export async function savePopupSettings(
  { storagePort }: PopupStorageDeps,
  input: PopupSettingsInput
) {
  await storagePort.set({
    ...input,
    tempChatEnabled: input.autoTempChat
  });
}
