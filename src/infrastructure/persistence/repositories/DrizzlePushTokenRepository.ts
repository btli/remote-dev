/**
 * DrizzlePushTokenRepository - Drizzle ORM implementation of PushTokenRepository.
 *
 * Handles persistence of FCM push notification tokens.
 */

import { db } from "@/db";
import { pushTokens } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import type {
  PushTokenRepository,
  PushTokenRecord,
} from "@/application/ports/PushTokenRepository";

export class DrizzlePushTokenRepository implements PushTokenRepository {
  async save(
    userId: string,
    fcmToken: string,
    platform: "android" | "ios",
    deviceId?: string
  ): Promise<PushTokenRecord> {
    const [row] = await db
      .insert(pushTokens)
      .values({
        userId,
        fcmToken,
        platform,
        deviceId: deviceId ?? null,
      })
      .onConflictDoUpdate({
        target: pushTokens.fcmToken,
        set: {
          userId,
          platform,
          deviceId: deviceId ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return this.mapRow(row);
  }

  async findByUser(userId: string): Promise<PushTokenRecord[]> {
    const rows = await db.query.pushTokens.findMany({
      where: eq(pushTokens.userId, userId),
    });
    return rows.map(this.mapRow);
  }

  async delete(userId: string, fcmToken: string): Promise<void> {
    await db
      .delete(pushTokens)
      .where(
        and(eq(pushTokens.userId, userId), eq(pushTokens.fcmToken, fcmToken))
      );
  }

  async deleteByTokens(fcmTokens: string[]): Promise<void> {
    if (fcmTokens.length === 0) return;
    await db
      .delete(pushTokens)
      .where(inArray(pushTokens.fcmToken, fcmTokens));
  }

  private mapRow(
    row: typeof pushTokens.$inferSelect
  ): PushTokenRecord {
    return {
      id: row.id,
      userId: row.userId,
      fcmToken: row.fcmToken,
      platform: row.platform,
      deviceId: row.deviceId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
