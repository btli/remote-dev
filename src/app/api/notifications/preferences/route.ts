import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as Prefs from "@/services/notification-preferences-service";
import type { UpdatePrefsInput } from "@/services/notification-preferences-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/notifications/preferences");

// GET /api/notifications/preferences — current notification prefs for the user.
export const GET = withApiAuth(async (_request, { userId }) => {
  try {
    const raw = await Prefs.getRawPrefs(userId);
    return NextResponse.json(
      raw ?? {
        pushByType: {},
        mutedSessionIds: [],
        quietHoursStart: null,
        quietHoursEnd: null,
        minPushSeverity: "actionable",
      },
    );
  } catch (error) {
    log.error("Error reading notification prefs", { error: String(error) });
    return errorResponse("Failed to read preferences", 500);
  }
});

// PUT /api/notifications/preferences — upsert (partial) notification prefs.
export const PUT = withApiAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<UpdatePrefsInput>(request);
    if ("error" in result) return result.error;
    await Prefs.upsertPrefs(userId, result.data);
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Error updating notification prefs", { error: String(error) });
    return errorResponse("Failed to update preferences", 500);
  }
});
