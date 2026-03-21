import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { pushTokenRepository } from "@/infrastructure/container";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/notifications/push-token");

// POST /api/notifications/push-token — register FCM token
export const POST = withApiAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<{
      token?: string;
      platform?: string;
      deviceId?: string;
    }>(request);
    if ("error" in result) return result.error;
    const { token, platform, deviceId } = result.data;

    if (!token || typeof token !== "string") {
      return errorResponse("token is required", 400);
    }
    if (platform !== "android" && platform !== "ios") {
      return errorResponse("platform must be 'android' or 'ios'", 400);
    }

    const record = await pushTokenRepository.save(
      userId,
      token,
      platform,
      deviceId
    );

    log.info("Push token registered", {
      userId,
      platform,
      tokenPrefix: token.slice(0, 12),
    });

    return NextResponse.json({ success: true, id: record.id });
  } catch (error) {
    log.error("Error registering push token", { error: String(error) });
    return errorResponse("Failed to register push token", 500);
  }
});

// DELETE /api/notifications/push-token — unregister FCM token
export const DELETE = withApiAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<{ token?: string }>(request);
    if ("error" in result) return result.error;
    const { token } = result.data;

    if (!token || typeof token !== "string") {
      return errorResponse("token is required", 400);
    }

    await pushTokenRepository.delete(userId, token);

    log.info("Push token unregistered", {
      userId,
      tokenPrefix: token.slice(0, 12),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Error unregistering push token", { error: String(error) });
    return errorResponse("Failed to unregister push token", 500);
  }
});
