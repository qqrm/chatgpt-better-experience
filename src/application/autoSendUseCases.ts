import { AutoSendDecision } from "../domain/autoSend";

export interface AutoSendDecisionInput {
  autoSendEnabled: boolean;
  heldDuring: boolean;
}

export function decideAutoSend({
  autoSendEnabled,
  heldDuring
}: AutoSendDecisionInput): AutoSendDecision {
  return {
    autoSendEnabled,
    heldDuring,
    shouldSend: autoSendEnabled && !heldDuring
  };
}
