export const MESSAGE_TIMESTAMPS_BRIDGE_SOURCE = "qqrm-message-timestamps-page-bridge";

export interface UserMessageSentBridgePayload {
  source: typeof MESSAGE_TIMESTAMPS_BRIDGE_SOURCE;
  type: "user-message-sent";
  conversationId: string | null;
  messageId: string;
  sentAtMs: number;
  createTimeMs: number | null;
}
