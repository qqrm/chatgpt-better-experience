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

export function buildAutoSendHint(skipKey: string, holdToSend: boolean): string {
  if (skipKey === "None") {
    return holdToSend
      ? "Auto-send is disabled because no modifier key is selected."
      : "Auto-send always happens when you accept dictation.";
  }

  return holdToSend
    ? `Auto-send happens only while holding ${skipKey} when you accept dictation.`
    : `Hold ${skipKey} while accepting dictation to skip auto-send.`;
}

export async function loadPopupSettings({ storagePort }: PopupStorageDeps) {
  const data = await storagePort.get(SETTINGS_DEFAULTS);
  const settings = normalizeSettings(data);
  return {
    settings,
    hint: buildAutoSendHint(settings.skipKey, settings.holdToSend)
  } satisfies PopupSettingsState;
}

export interface PopupSettingsInput {
  skipKey: string;
  holdToSend: boolean;
  allowAutoSendInCodex: boolean;
  editLastMessageOnArrowUp: boolean;
  autoExpandChats: boolean;
  autoTempChat: boolean;
  oneClickDelete: boolean;
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
    hint: buildAutoSendHint(input.skipKey, input.holdToSend)
  };
}
