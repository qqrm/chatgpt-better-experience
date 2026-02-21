export interface Settings {
  autoSend: boolean;
  allowAutoSendInCodex: boolean;
  editLastMessageOnArrowUp: boolean;
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
}

export type SettingsRecord = Settings & Record<string, unknown>;

export const SETTINGS_DEFAULTS: SettingsRecord = {
  autoSend: true,
  allowAutoSendInCodex: true,
  editLastMessageOnArrowUp: true,
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
  macroRecorderEnabled: false
};
