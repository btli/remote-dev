/**
 * PushNotificationGateway - Port interface for dispatching push notifications to devices.
 */

export interface PushPayload {
  title: string;
  body: string | null;
  data: Record<string, string>;
}

export interface PushSendResult {
  /** FCM tokens that are no longer valid and should be removed. */
  staleTokens: string[];
}

export interface PushNotificationGateway {
  /**
   * Send a push notification to the given device tokens.
   * Returns information about stale tokens that should be cleaned up.
   * Must not throw — failures are logged internally.
   */
  sendToTokens(tokens: string[], payload: PushPayload): Promise<PushSendResult>;
}
