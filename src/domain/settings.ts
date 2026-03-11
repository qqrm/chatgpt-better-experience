export type DebugTraceTarget = "projects" | "editMessage" | "autoSend";

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
