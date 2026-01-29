export interface Settings {
  autoSend: boolean;
  allowAutoSendInCodex: boolean;
  editLastMessageOnArrowUp: boolean;
  autoExpandChats: boolean;
  autoExpandProjects: boolean;
  autoTempChat: boolean;
  tempChatEnabled: boolean;
  oneClickDelete: boolean;
  startDictation: boolean;
  ctrlEnterSends: boolean;
  wideChatWidth: number;
}

export type SettingsRecord = Settings & Record<string, unknown>;

export const SETTINGS_DEFAULTS: SettingsRecord = {
  autoSend: true,
  allowAutoSendInCodex: true,
  editLastMessageOnArrowUp: true,
  autoExpandChats: true,
  autoExpandProjects: true,
  autoTempChat: false,
  tempChatEnabled: false,
  oneClickDelete: false,
  startDictation: false,
  ctrlEnterSends: true,
  wideChatWidth: 0
};
