export interface AutoSendDecision {
  shouldSend: boolean;
  heldDuring: boolean;
  autoSendEnabled: boolean;
}

export interface AutoSendRequestedEvent {
  type: "AutoSendRequested";
  decision: AutoSendDecision;
}

export interface AutoSendCompletedEvent {
  type: "AutoSendCompleted";
  success: boolean;
}
