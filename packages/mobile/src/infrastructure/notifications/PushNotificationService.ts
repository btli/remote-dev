import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { getApiClient } from "../api/RemoteDevApiClient";

interface PushNotification {
  id: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

type NotificationHandler = (notification: PushNotification) => void;
type NotificationResponseHandler = (sessionId: string) => void;

/**
 * Push notification service for agent completion and session events.
 * Uses Expo Notifications (FCM on Android, APNs on iOS).
 */
export class PushNotificationService {
  private pushToken: string | null = null;
  private notificationHandlers: Set<NotificationHandler> = new Set();
  private responseHandlers: Set<NotificationResponseHandler> = new Set();
  private notificationSubscription: Notifications.Subscription | null = null;
  private responseSubscription: Notifications.Subscription | null = null;

  constructor() {
    // Configure notification behavior
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
  }

  /**
   * Initialize push notifications.
   * Requests permissions and registers for push tokens.
   */
  async initialize(): Promise<boolean> {
    try {
      // Check if we're on a physical device (push won't work on simulator)
      if (!Device.isDevice) {
        console.log("[PushNotification] Not a physical device, skipping push setup");
        return false;
      }

      // Request permissions
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== "granted") {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== "granted") {
        console.log("[PushNotification] Permission not granted");
        return false;
      }

      // Get push token
      const token = await this.getPushToken();
      if (!token) {
        console.log("[PushNotification] Failed to get push token");
        return false;
      }

      this.pushToken = token;
      if (__DEV__) {
        // Only log token prefix in dev to avoid exposing full token
        console.log("[PushNotification] Push token obtained:", token.slice(0, 20) + "...");
      }

      // Register token with backend
      await this.registerTokenWithBackend(token);

      // Set up notification listeners
      this.setupListeners();

      // Android-specific: create notification channel
      if (Platform.OS === "android") {
        await this.createAndroidChannel();
      }

      return true;
    } catch (error) {
      console.error("[PushNotification] Initialization error:", error);
      return false;
    }
  }

  /**
   * Get the Expo push token.
   */
  private async getPushToken(): Promise<string | null> {
    try {
      // For Expo managed workflow
      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId: process.env.EXPO_PUBLIC_PROJECT_ID,
      });
      return tokenData.data;
    } catch (error) {
      console.error("[PushNotification] Error getting push token:", error);

      // Fallback: try to get device push token directly
      try {
        const deviceToken = await Notifications.getDevicePushTokenAsync();
        return deviceToken.data;
      } catch {
        return null;
      }
    }
  }

  /**
   * Register push token with backend.
   */
  private async registerTokenWithBackend(token: string): Promise<void> {
    try {
      const apiClient = getApiClient();
      await apiClient.registerPushToken(token);
      console.log("[PushNotification] Token registered with backend");
    } catch (error) {
      console.error("[PushNotification] Failed to register token:", error);
      // Don't throw - push will still work locally
    }
  }

  /**
   * Set up notification listeners.
   */
  private setupListeners(): void {
    // Handle notifications received while app is foregrounded
    this.notificationSubscription = Notifications.addNotificationReceivedListener(
      (notification) => {
        const pushNotification: PushNotification = {
          id: notification.request.identifier,
          title: notification.request.content.title || "",
          body: notification.request.content.body || "",
          data: notification.request.content.data as Record<string, unknown>,
        };

        console.log("[PushNotification] Received:", pushNotification);
        this.notifyHandlers(pushNotification);
      }
    );

    // Handle notification taps
    this.responseSubscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as Record<string, unknown>;
        const sessionId = data?.sessionId as string;

        if (sessionId) {
          console.log("[PushNotification] Tapped, navigating to session:", sessionId);
          this.notifyResponseHandlers(sessionId);
        }
      }
    );
  }

  /**
   * Create Android notification channel.
   */
  private async createAndroidChannel(): Promise<void> {
    await Notifications.setNotificationChannelAsync("agent-completion", {
      name: "Agent Completion",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#7aa2f7",
      sound: "default",
    });
  }

  /**
   * Show a local notification (for testing or fallback).
   */
  async showLocalNotification(
    title: string,
    body: string,
    data?: Record<string, unknown>
  ): Promise<string> {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data,
        sound: "default",
      },
      trigger: null, // Immediate
    });

    return id;
  }

  /**
   * Show agent completion notification.
   */
  async showAgentCompletionNotification(
    sessionName: string,
    exitCode: number | null,
    sessionId: string
  ): Promise<void> {
    const exitMessage = exitCode === 0 ? "completed successfully" : `exited with code ${exitCode}`;

    await this.showLocalNotification(
      "Agent Completed",
      `${sessionName} ${exitMessage}`,
      { sessionId, type: "agent_exit", exitCode }
    );
  }

  /**
   * Register a handler for received notifications.
   */
  onNotification(handler: NotificationHandler): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  /**
   * Register a handler for notification taps (opens session).
   */
  onNotificationTap(handler: NotificationResponseHandler): () => void {
    this.responseHandlers.add(handler);
    return () => this.responseHandlers.delete(handler);
  }

  /**
   * Get the current push token.
   */
  getToken(): string | null {
    return this.pushToken;
  }

  /**
   * Clean up listeners.
   */
  cleanup(): void {
    if (this.notificationSubscription) {
      this.notificationSubscription.remove();
      this.notificationSubscription = null;
    }
    if (this.responseSubscription) {
      this.responseSubscription.remove();
      this.responseSubscription = null;
    }
  }

  private notifyHandlers(notification: PushNotification): void {
    for (const handler of this.notificationHandlers) {
      try {
        handler(notification);
      } catch (error) {
        console.error("[PushNotification] Handler error:", error);
      }
    }
  }

  private notifyResponseHandlers(sessionId: string): void {
    for (const handler of this.responseHandlers) {
      try {
        handler(sessionId);
      } catch (error) {
        console.error("[PushNotification] Response handler error:", error);
      }
    }
  }
}

// Singleton instance
let pushService: PushNotificationService | null = null;

export function getPushNotificationService(): PushNotificationService {
  if (!pushService) {
    pushService = new PushNotificationService();
  }
  return pushService;
}
