/**
 * PushTokenRepository - Port interface for persisting FCM device tokens.
 */

export interface PushTokenRecord {
  id: string;
  userId: string;
  fcmToken: string;
  platform: "android" | "ios";
  deviceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PushTokenRepository {
  /** Save or update a push token for a user. Upserts by fcmToken. */
  save(
    userId: string,
    fcmToken: string,
    platform: "android" | "ios",
    deviceId?: string
  ): Promise<PushTokenRecord>;

  /** Find all push tokens for a user. */
  findByUser(userId: string): Promise<PushTokenRecord[]>;

  /** Delete a specific token for a user. */
  delete(userId: string, fcmToken: string): Promise<void>;

  /** Delete tokens by their FCM token values (for stale token cleanup). */
  deleteByTokens(fcmTokens: string[]): Promise<void>;
}
