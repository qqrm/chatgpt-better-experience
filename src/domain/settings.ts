export type DebugTraceTarget = "projects" | "editMessage" | "autoSend" | "timestamps";

export const AUTO_EXPAND_PROJECTS_REGISTRY_KEY = "autoExpandProjectsRegistryV1";
export const AUTO_EXPAND_PROJECTS_PREFS_KEY = "autoExpandProjectsPrefsV1";
export const AUTO_EXPAND_PROJECTS_LOCAL_VERSION = 1 as const;

export interface AutoExpandProjectsRegistryEntry {
  href: string;
  title: string;
  lastSeenAt: number;
  lastSeenOrder: number;
}

export interface AutoExpandProjectsRegistry {
  version: typeof AUTO_EXPAND_PROJECTS_LOCAL_VERSION;
  entriesByHref: Record<string, AutoExpandProjectsRegistryEntry>;
}

export interface AutoExpandProjectsPrefs {
  version: typeof AUTO_EXPAND_PROJECTS_LOCAL_VERSION;
  expandedByHref: Record<string, boolean>;
}

export const AUTO_EXPAND_PROJECTS_REGISTRY_DEFAULTS: AutoExpandProjectsRegistry = {
  version: AUTO_EXPAND_PROJECTS_LOCAL_VERSION,
  entriesByHref: {}
};

export const AUTO_EXPAND_PROJECTS_PREFS_DEFAULTS: AutoExpandProjectsPrefs = {
  version: AUTO_EXPAND_PROJECTS_LOCAL_VERSION,
  expandedByHref: {}
};

export interface Settings {
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
  tempChatEnabled: boolean;
  oneClickDelete: boolean;
  startDictation: boolean;
  ctrlEnterSends: boolean;
  wideChatWidth: number;
  trimChatDom: boolean;
  trimChatDomKeep: number;
  hideShareButton: boolean;
  macroRecorderEnabled: boolean;

  /** Enables debug console logs; use debugTraceTarget to choose the traced subsystem. */
  debugAutoExpandProjects: boolean;

  /** Chooses which subsystem writes debug logs when debugAutoExpandProjects=true. */
  debugTraceTarget: DebugTraceTarget;
}

export type SettingsRecord = Settings & Record<string, unknown>;

export const SETTINGS_DEFAULTS: SettingsRecord = {
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
