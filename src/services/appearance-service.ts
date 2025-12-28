/**
 * AppearanceService - Manages user appearance settings and color schemes
 *
 * Handles:
 * - User appearance preferences (mode, schemes, terminal settings)
 * - Color scheme management
 * - Migration from old theme field
 */

import { db } from "@/db";
import { users, appearanceSettings, colorSchemes } from "@/db/schema";
import { eq } from "drizzle-orm";
import type {
  AppearanceSettings,
  UpdateAppearanceInput,
  ColorSchemeId,
  AppearanceMode,
} from "@/types/appearance";
import { isValidColorSchemeId, isValidAppearanceMode } from "@/types/appearance";
import { COLOR_SCHEMES, getColorScheme } from "@/lib/color-schemes";

// =============================================================================
// Error Handling
// =============================================================================

export class AppearanceServiceError extends Error {
  constructor(
    message: string,
    public code:
      | "USER_NOT_FOUND"
      | "SETTINGS_NOT_FOUND"
      | "INVALID_SCHEME"
      | "INVALID_MODE"
      | "VALIDATION_ERROR"
  ) {
    super(message);
    this.name = "AppearanceServiceError";
  }
}

// =============================================================================
// Type Mappers
// =============================================================================

interface DbAppearanceSettings {
  id: string;
  userId: string;
  appearanceMode: string;
  lightColorScheme: string;
  darkColorScheme: string;
  terminalOpacity: number;
  terminalBlur: number;
  terminalCursorStyle: string;
  createdAt: Date;
  updatedAt: Date;
}

function mapDbSettings(row: DbAppearanceSettings): AppearanceSettings {
  return {
    id: row.id,
    userId: row.userId,
    appearanceMode: row.appearanceMode as AppearanceMode,
    lightColorScheme: row.lightColorScheme as ColorSchemeId,
    darkColorScheme: row.darkColorScheme as ColorSchemeId,
    terminalOpacity: row.terminalOpacity,
    terminalBlur: row.terminalBlur,
    terminalCursorStyle: row.terminalCursorStyle as "block" | "underline" | "bar",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// =============================================================================
// Appearance Settings Operations
// =============================================================================

/**
 * Get user appearance settings, creating defaults if not exists
 */
export async function getAppearanceSettings(userId: string): Promise<AppearanceSettings> {
  const settings = await db.query.appearanceSettings.findFirst({
    where: eq(appearanceSettings.userId, userId),
  });

  if (!settings) {
    // Verify user exists before creating settings
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw new AppearanceServiceError(
        "User not found - session may be stale, please re-login",
        "USER_NOT_FOUND"
      );
    }

    // Create default settings for new user
    const [newSettings] = await db
      .insert(appearanceSettings)
      .values({
        userId,
        appearanceMode: "system",
        lightColorScheme: "ocean",
        darkColorScheme: "midnight",
        terminalOpacity: 100,
        terminalBlur: 0,
        terminalCursorStyle: "block",
      })
      .returning();

    return mapDbSettings(newSettings as DbAppearanceSettings);
  }

  return mapDbSettings(settings as DbAppearanceSettings);
}

/**
 * Update user appearance settings
 */
export async function updateAppearanceSettings(
  userId: string,
  updates: UpdateAppearanceInput
): Promise<AppearanceSettings> {
  // Validate inputs
  if (updates.appearanceMode && !isValidAppearanceMode(updates.appearanceMode)) {
    throw new AppearanceServiceError(
      `Invalid appearance mode: ${updates.appearanceMode}`,
      "INVALID_MODE"
    );
  }

  if (updates.lightColorScheme && !isValidColorSchemeId(updates.lightColorScheme)) {
    throw new AppearanceServiceError(
      `Invalid light color scheme: ${updates.lightColorScheme}`,
      "INVALID_SCHEME"
    );
  }

  if (updates.darkColorScheme && !isValidColorSchemeId(updates.darkColorScheme)) {
    throw new AppearanceServiceError(
      `Invalid dark color scheme: ${updates.darkColorScheme}`,
      "INVALID_SCHEME"
    );
  }

  if (updates.terminalOpacity !== undefined) {
    if (updates.terminalOpacity < 0 || updates.terminalOpacity > 100) {
      throw new AppearanceServiceError(
        "Terminal opacity must be between 0 and 100",
        "VALIDATION_ERROR"
      );
    }
  }

  if (updates.terminalBlur !== undefined) {
    if (updates.terminalBlur < 0 || updates.terminalBlur > 100) {
      throw new AppearanceServiceError(
        "Terminal blur must be between 0 and 100",
        "VALIDATION_ERROR"
      );
    }
  }

  if (updates.terminalCursorStyle) {
    if (!["block", "underline", "bar"].includes(updates.terminalCursorStyle)) {
      throw new AppearanceServiceError(
        `Invalid cursor style: ${updates.terminalCursorStyle}`,
        "VALIDATION_ERROR"
      );
    }
  }

  // Ensure settings exist first
  await getAppearanceSettings(userId);

  const [updated] = await db
    .update(appearanceSettings)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(appearanceSettings.userId, userId))
    .returning();

  return mapDbSettings(updated as DbAppearanceSettings);
}

/**
 * Delete user appearance settings (resets to defaults)
 */
export async function deleteAppearanceSettings(userId: string): Promise<void> {
  await db
    .delete(appearanceSettings)
    .where(eq(appearanceSettings.userId, userId));
}

// =============================================================================
// Color Scheme Operations
// =============================================================================

/**
 * Get all available color schemes
 * Currently returns built-in schemes; future: include custom user schemes
 */
export function getAllColorSchemes() {
  return COLOR_SCHEMES;
}

/**
 * Get a color scheme by ID
 */
export function getColorSchemeById(id: ColorSchemeId) {
  return getColorScheme(id);
}

/**
 * Seed built-in color schemes to database
 * Called during database initialization
 */
export async function seedColorSchemes(): Promise<void> {
  for (const scheme of COLOR_SCHEMES) {
    const existing = await db.query.colorSchemes.findFirst({
      where: eq(colorSchemes.id, scheme.id),
    });

    if (!existing) {
      await db.insert(colorSchemes).values({
        id: scheme.id,
        name: scheme.name,
        description: scheme.description,
        category: scheme.category,
        colorDefinitions: JSON.stringify({
          light: scheme.light,
          dark: scheme.dark,
        }),
        terminalPalette: null, // Uses colorDefinitions
        isBuiltIn: true,
        sortOrder: scheme.sortOrder,
      });
    }
  }
}

// =============================================================================
// Migration Helpers
// =============================================================================

/**
 * Map old terminal theme name to new color scheme
 */
export function mapLegacyThemeToScheme(theme: string | null): ColorSchemeId {
  switch (theme) {
    case "tokyo-night":
      return "midnight";
    case "dracula":
      return "sunset";
    case "nord":
      return "ocean";
    case "monokai":
      return "forest";
    default:
      return "midnight"; // Default fallback
  }
}

/**
 * Migrate user from old theme field to new appearance settings
 * Call this when user first accesses appearance settings
 */
export async function migrateFromLegacyTheme(
  userId: string,
  legacyTheme: string | null
): Promise<AppearanceSettings> {
  const darkScheme = mapLegacyThemeToScheme(legacyTheme);

  // Check if settings already exist
  const existing = await db.query.appearanceSettings.findFirst({
    where: eq(appearanceSettings.userId, userId),
  });

  if (existing) {
    return mapDbSettings(existing as DbAppearanceSettings);
  }

  // Create new settings with migrated theme
  const [newSettings] = await db
    .insert(appearanceSettings)
    .values({
      userId,
      appearanceMode: "dark", // Legacy users were in dark mode
      lightColorScheme: "ocean",
      darkColorScheme: darkScheme,
      terminalOpacity: 100,
      terminalBlur: 0,
      terminalCursorStyle: "block",
    })
    .returning();

  return mapDbSettings(newSettings as DbAppearanceSettings);
}
