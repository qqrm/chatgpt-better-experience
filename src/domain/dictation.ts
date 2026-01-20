export type DictationInputKind = "textarea" | "contenteditable" | "none";

export interface DictationConfig {
  enabled: boolean;
  autoSendEnabled: boolean;
  modifierGraceMs: number;
  finalTextTimeoutMs: number;
  finalTextQuietMs: number;
  sendAckTimeoutMs: number;
}

export interface DictationSnapshot {
  text: string;
  kind: DictationInputKind;
  inputOk: boolean;
}

export interface DictationAcceptedEvent {
  type: "DictationAccepted";
  snapshot: DictationSnapshot;
  acceptedAtMs: number;
}

export interface DictationFinalizedEvent {
  type: "DictationFinalized";
  snapshot: DictationSnapshot;
  stableForMs: number;
}
