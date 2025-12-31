/**
 * Agent Profile Appearance Service
 *
 * Manages per-profile appearance settings including theme mode,
 * color schemes, and terminal appearance options.
 */

import { db } from "@/db";
import { profileAppearanceSettings } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import type {
  ProfileAppearanceSettings,
  UpdateProfileAppearanceInput,
} from "@/types/agent";

/**
 * Map database record to ProfileAppearanceSettings type.
 */
function mapDbToAppearance(
  record: typeof profileAppearanceSettings.$inferSelect
): ProfileAppearanceSettings {
  return {
    id: record.id,
    profileId: record.profileId,
    userId: record.userId,
    appearanceMode: record.appearanceMode,
    lightColorScheme: record.lightColorScheme,
    darkColorScheme: record.darkColorScheme,
    terminalOpacity: record.terminalOpacity,
    terminalBlur: record.terminalBlur,
    terminalCursorStyle: record.terminalCursorStyle,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Get profile appearance settings.
 * Returns null if no custom settings exist (uses user defaults).
 */
export async function getProfileAppearance(
  profileId: string,
  userId: string
): Promise<ProfileAppearanceSettings | null> {
  const settings = await db.query.profileAppearanceSettings.findFirst({
    where: and(
      eq(profileAppearanceSettings.profileId, profileId),
      eq(profileAppearanceSettings.userId, userId)
    ),
  });

  return settings ? mapDbToAppearance(settings) : null;
}

/**
 * Get profile appearance settings by profile ID only.
 * Used when user context is not needed.
 */
export async function getProfileAppearanceById(
  profileId: string
): Promise<ProfileAppearanceSettings | null> {
  const settings = await db.query.profileAppearanceSettings.findFirst({
    where: eq(profileAppearanceSettings.profileId, profileId),
  });

  return settings ? mapDbToAppearance(settings) : null;
}

/**
 * Update or create profile appearance settings.
 */
export async function updateProfileAppearance(
  profileId: string,
  userId: string,
  input: UpdateProfileAppearanceInput
): Promise<ProfileAppearanceSettings> {
  const existing = await getProfileAppearance(profileId, userId);
  const now = new Date();

  if (existing) {
    const [updated] = await db
      .update(profileAppearanceSettings)
      .set({
        ...input,
        updatedAt: now,
      })
      .where(
        and(
          eq(profileAppearanceSettings.profileId, profileId),
          eq(profileAppearanceSettings.userId, userId)
        )
      )
      .returning();

    return mapDbToAppearance(updated);
  }

  // Create new settings with defaults for unspecified fields
  const [created] = await db
    .insert(profileAppearanceSettings)
    .values({
      profileId,
      userId,
      appearanceMode: input.appearanceMode ?? "system",
      lightColorScheme: input.lightColorScheme ?? "ocean",
      darkColorScheme: input.darkColorScheme ?? "midnight",
      terminalOpacity: input.terminalOpacity ?? 100,
      terminalBlur: input.terminalBlur ?? 0,
      terminalCursorStyle: input.terminalCursorStyle ?? "block",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return mapDbToAppearance(created);
}

/**
 * Delete profile appearance settings (revert to user defaults).
 */
export async function deleteProfileAppearance(
  profileId: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .delete(profileAppearanceSettings)
    .where(
      and(
        eq(profileAppearanceSettings.profileId, profileId),
        eq(profileAppearanceSettings.userId, userId)
      )
    );

  return (result.rowsAffected ?? 0) > 0;
}

/**
 * Get all profile appearance settings for a user.
 */
export async function getAllProfileAppearances(
  userId: string
): Promise<ProfileAppearanceSettings[]> {
  const settings = await db.query.profileAppearanceSettings.findMany({
    where: eq(profileAppearanceSettings.userId, userId),
  });

  return settings.map(mapDbToAppearance);
}
