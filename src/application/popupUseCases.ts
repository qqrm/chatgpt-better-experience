import { SETTINGS_DEFAULTS, Settings } from "../domain/settings";
import { StoragePort } from "../domain/ports/storagePort";
import { normalizeSettings } from "../lib/utils";

export interface PopupStorageDeps {
  storagePort: StoragePort;
}

export interface PopupSettingsState {
  settings: Settings;
}

export async function loadPopupSettings({ storagePort }: PopupStorageDeps) {
  const data = await storagePort.get(SETTINGS_DEFAULTS);
  const settings = normalizeSettings(data);
  return {
    settings
  } satisfies PopupSettingsState;
}

export interface PopupSettingsInput {
  autoSend: boolean;
  allowAutoSendInCodex: boolean;
  downloadGitPatchesWithShiftClick: boolean;
  clearClipboardAfterShiftDownload: boolean;
  editLastMessageOnArrowUp: boolean;
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
