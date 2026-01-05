import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import {
  getAppearanceSettings,
  updateAppearanceSettings,
  getAllColorSchemes,
  AppearanceServiceError,
} from "@/services/appearance-service";
import { oklchToHex } from "@/lib/color-schemes";
import type { UpdateAppearanceInput } from "@/types/appearance";

/**
 * GET /api/appearance
 * Returns user appearance settings and available color schemes
 */
export const GET = withAuth(async (_request, { userId }) => {
  try {
    const [settings, schemes] = await Promise.all([
      getAppearanceSettings(userId),
      Promise.resolve(getAllColorSchemes()),
    ]);

    return NextResponse.json({
      settings,
      // Use semantic colors for preview (not terminal colors, since terminal
      // always uses dark palette even in light mode for CLI readability)
      schemes: schemes.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        category: s.category,
        isBuiltIn: s.isBuiltIn,
        sortOrder: s.sortOrder,
        preview: {
          light: {
            background: oklchToHex(s.light.semantic.background),
            foreground: oklchToHex(s.light.semantic.foreground),
            accent: oklchToHex(s.light.semantic.primary),
          },
          dark: {
            background: oklchToHex(s.dark.semantic.background),
            foreground: oklchToHex(s.dark.semantic.foreground),
            accent: oklchToHex(s.dark.semantic.primary),
          },
        },
      })),
    });
  } catch (error) {
    if (error instanceof AppearanceServiceError && error.code === "USER_NOT_FOUND") {
      return errorResponse("Session expired - please sign out and sign in again", 401, "USER_NOT_FOUND");
    }
    throw error;
  }
});

/**
 * PATCH /api/appearance
 * Updates user appearance settings
 */
export const PATCH = withAuth(async (request, { userId }) => {
  try {
    const body = await request.json();

    // Validate and filter allowed fields
    const allowedFields: (keyof UpdateAppearanceInput)[] = [
      "appearanceMode",
      "lightColorScheme",
      "darkColorScheme",
      "terminalOpacity",
      "terminalBlur",
      "terminalCursorStyle",
    ];

    const updates: UpdateAppearanceInput = {};
    for (const key of allowedFields) {
      if (key in body) {
        (updates as Record<string, unknown>)[key] = body[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return errorResponse("No valid fields to update", 400);
    }

    const updated = await updateAppearanceSettings(userId, updates);
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof AppearanceServiceError) {
      switch (error.code) {
        case "USER_NOT_FOUND":
          return errorResponse("Session expired - please sign out and sign in again", 401, "USER_NOT_FOUND");
        case "INVALID_SCHEME":
        case "INVALID_MODE":
        case "VALIDATION_ERROR":
          return errorResponse(error.message, 400, error.code);
        default:
          throw error;
      }
    }
    throw error;
  }
});
