export interface Settings {
  skipKey: string;
  holdToSend: boolean;
  allowAutoSendInCodex: boolean;
  editLastMessageOnArrowUp: boolean;
  autoExpandChats: boolean;
  autoTempChat: boolean;
  tempChatEnabled: boolean;
  oneClickDelete: boolean;
  wideChatWidth: number;
  enableBottomCopyButton: boolean;
  showOnHoverOnly: boolean;
  buttonSize: "S" | "M" | "L";
  edgeOffsetPx: number;
  showCopiedFeedback: boolean;
}

export type SettingsRecord = Settings & Record<string, unknown>;

export const SETTINGS_DEFAULTS: SettingsRecord = {
  skipKey: "Shift",
  holdToSend: false,
  allowAutoSendInCodex: false,
  editLastMessageOnArrowUp: true,
  autoExpandChats: true,
  autoTempChat: false,
  tempChatEnabled: false,
  oneClickDelete: false,
  wideChatWidth: 0,
  enableBottomCopyButton: true,
  showOnHoverOnly: false,
  buttonSize: "M",
  edgeOffsetPx: 8,
  showCopiedFeedback: true
};
