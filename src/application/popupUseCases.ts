import { SETTINGS_DEFAULTS, Settings } from "../domain/settings";
import { StoragePort } from "../domain/ports/storagePort";
import { normalizeSettings } from "../lib/utils";

export interface PopupStorageDeps {
  storagePort: StoragePort;
}

export interface PopupSettingsState {
  settings: Settings;
  hint: string;
}

export function buildAutoSendHint(autoSendEnabled: boolean): string {
  return autoSendEnabled
    ? "Hold Shift while accepting dictation to skip auto-send."
    : "Auto-send is disabled.";
}

export async function loadPopupSettings({ storagePort }: PopupStorageDeps) {
  const data = await storagePort.get(SETTINGS_DEFAULTS);
  const settings = normalizeSettings(data);
  return {
    settings,
    hint: buildAutoSendHint(settings.autoSend)
  } satisfies PopupSettingsState;
}

export interface PopupSettingsInput {
  autoSend: boolean;
  allowAutoSendInCodex: boolean;
  editLastMessageOnArrowUp: boolean;
  autoExpandChats: boolean;
  autoExpandProjects: boolean;
  autoExpandProjectItems: boolean;
  autoTempChat: boolean;
  oneClickDelete: boolean;
  startDictation: boolean;
  ctrlEnterSends: boolean;
  wideChatWidth: number;
}

export async function savePopupSettings(
  { storagePort }: PopupStorageDeps,
  input: PopupSettingsInput
) {
  await storagePort.set({
    ...input,
    tempChatEnabled: input.autoTempChat
  });

  return {
    hint: buildAutoSendHint(input.autoSend)
  };
}
