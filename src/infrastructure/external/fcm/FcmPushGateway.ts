/**
 * FcmPushGateway - FCM HTTP v1 API implementation of PushNotificationGateway.
 *
 * Sends push notifications via Firebase Cloud Messaging.
 * When FCM is not configured (no service account / project ID), uses NullPushGateway.
 */

import { GoogleAuth } from "google-auth-library";
import { createLogger } from "@/lib/logger";
import type {
  PushNotificationGateway,
  PushPayload,
  PushSendResult,
} from "@/application/ports/PushNotificationGateway";

const log = createLogger("FcmPushGateway");

/** Must match the channel ID in mobile/android/app/src/main/AndroidManifest.xml */
const ANDROID_CHANNEL_ID = "rdv_notifications";

export class FcmPushGateway implements PushNotificationGateway {
  private readonly projectId: string;
  private readonly auth: GoogleAuth;
  private authClient: Awaited<ReturnType<GoogleAuth["getClient"]>> | null = null;

  constructor(projectId: string, serviceAccountPath: string) {
    this.projectId = projectId;
    this.auth = new GoogleAuth({
      keyFile: serviceAccountPath,
      scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
    });
  }

  async sendToTokens(
    tokens: string[],
    payload: PushPayload
  ): Promise<PushSendResult> {
    if (tokens.length === 0) {
      return { staleTokens: [] };
    }

    const staleTokens: string[] = [];

    try {
      const accessToken = await this.getAccessToken();
      const url = `https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`;

      const results = await Promise.allSettled(
        tokens.map((token) => this.sendSingle(url, accessToken, token, payload))
      );

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === "rejected") {
          const errorCode = this.extractErrorCode(result.reason);
          if (errorCode === "UNREGISTERED") {
            staleTokens.push(tokens[i]);
            log.debug("Stale FCM token detected", { tokenPrefix: tokens[i].slice(0, 12) });
          } else {
            log.warn("FCM send failed for token", {
              tokenPrefix: tokens[i].slice(0, 12),
              errorCode,
              error: String(result.reason),
            });
          }
        }
      }

      if (staleTokens.length > 0) {
        log.info("Removing stale FCM tokens", { count: staleTokens.length });
      }
    } catch (err) {
      log.warn("FCM dispatch failed", { error: String(err) });
    }

    return { staleTokens };
  }

  private async getAccessToken(): Promise<string> {
    if (!this.authClient) {
      this.authClient = await this.auth.getClient();
    }
    const tokenResponse = await this.authClient.getAccessToken();
    if (!tokenResponse.token) {
      throw new Error("Failed to obtain FCM access token");
    }
    return tokenResponse.token;
  }

  private async sendSingle(
    url: string,
    accessToken: string,
    token: string,
    payload: PushPayload
  ): Promise<void> {
    const message: Record<string, unknown> = {
      message: {
        token,
        data: payload.data,
        notification: {
          title: payload.title,
          body: payload.body ?? undefined,
        },
        android: {
          priority: "high",
          notification: {
            channel_id: ANDROID_CHANNEL_ID,
          },
        },
        apns: {
          headers: { "apns-priority": "10" },
          payload: {
            aps: {
              sound: "default",
            },
          },
        },
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const body = await response.text();
      const error = new Error(`FCM HTTP ${response.status}: ${body}`);
      (error as unknown as Record<string, unknown>).fcmResponseBody = body;
      throw error;
    }
  }

  private extractErrorCode(error: unknown): string | null {
    if (error instanceof Error) {
      const body = (error as unknown as Record<string, unknown>).fcmResponseBody;
      if (typeof body === "string") {
        try {
          const parsed = JSON.parse(body);
          const details = parsed?.error?.details;
          if (Array.isArray(details)) {
            for (const detail of details) {
              if (detail.errorCode) return detail.errorCode;
            }
          }
          return parsed?.error?.status ?? null;
        } catch {
          return null;
        }
      }
    }
    return null;
  }
}

/**
 * NullPushGateway — no-op implementation used when FCM is not configured.
 */
export class NullPushGateway implements PushNotificationGateway {
  async sendToTokens(): Promise<PushSendResult> {
    return { staleTokens: [] };
  }
}
