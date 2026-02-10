import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { getApiClient } from "../api/RemoteDevApiClient";
import { getBiometricService } from "../biometrics/BiometricService";

interface CloudflareAccessResult {
  success: boolean;
  apiKey?: string;
  userId?: string;
  email?: string;
  error?: string;
}

/**
 * Cloudflare Access authentication service.
 * Handles the OAuth-like flow for Zero Trust authentication.
 */
export class CloudflareAccessService {
  private baseUrl: string;
  private redirectUri: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    // Deep link scheme: remotedev://auth-callback
    this.redirectUri = Linking.createURL("auth-callback");
  }

  /**
   * Start the Cloudflare Access authentication flow.
   *
   * Flow:
   * 1. Open CF Access login page in browser
   * 2. User authenticates with SSO/TOTP
   * 3. CF redirects to our callback with token
   * 4. Exchange CF token for API key
   * 5. Store credentials securely
   */
  async authenticate(): Promise<CloudflareAccessResult> {
    try {
      // Build the login URL with redirect
      const loginUrl = `${this.baseUrl}/login?mobile=true&redirect=${encodeURIComponent(this.redirectUri)}`;

      if (__DEV__) {
        console.log("[CloudflareAccess] Opening browser for authentication");
        console.log("[CloudflareAccess] Redirect URI:", this.redirectUri);
      }

      // Open the browser for authentication
      const result = await WebBrowser.openAuthSessionAsync(loginUrl, this.redirectUri, {
        showInRecents: true,
        preferEphemeralSession: false, // Keep session for SSO
      });

      if (result.type !== "success" || !result.url) {
        if (result.type === "cancel") {
          return { success: false, error: "Authentication cancelled" };
        }
        return { success: false, error: "Authentication failed" };
      }

      if (__DEV__) {
        // Log URL without sensitive token params in dev only
        const sanitizedUrl = result.url.split("?")[0];
        console.log("[CloudflareAccess] Received callback from:", sanitizedUrl);
      }

      // Parse the callback URL
      const url = new URL(result.url);
      const cfToken = url.searchParams.get("cf_token") || url.searchParams.get("token");

      if (!cfToken) {
        // Check if there's an error in the URL
        const error = url.searchParams.get("error");
        if (error) {
          return { success: false, error: decodeURIComponent(error) };
        }
        return { success: false, error: "No token received from Cloudflare Access" };
      }

      if (__DEV__) {
        console.log("[CloudflareAccess] Exchanging CF token for API key");
      }

      // Exchange CF token for API key
      const apiClient = getApiClient();
      const exchangeResult = await apiClient.exchangeCfToken(cfToken);

      if (__DEV__) {
        console.log("[CloudflareAccess] Authenticated user:", exchangeResult.email);
      }

      // Store credentials securely
      const biometricService = getBiometricService();
      await biometricService.storeCredentials(
        exchangeResult.userId,
        exchangeResult.email,
        exchangeResult.apiKey
      );

      // Configure API client with new key
      apiClient.setApiKey(exchangeResult.apiKey);

      return {
        success: true,
        apiKey: exchangeResult.apiKey,
        userId: exchangeResult.userId,
        email: exchangeResult.email,
      };
    } catch (error) {
      console.error("[CloudflareAccess] Authentication error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Authentication failed",
      };
    }
  }

  /**
   * Retrieve and validate stored credentials.
   * Returns credentials if valid, null otherwise.
   */
  private async getValidCredentials(): Promise<{
    apiKey: string;
    userId: string;
    email: string;
  } | null> {
    const biometricService = getBiometricService();

    const hasCredentials = await biometricService.hasStoredCredentials();
    if (!hasCredentials) {
      return null;
    }

    const apiKey = await biometricService.getApiKey();
    const userId = await biometricService.getUserId();
    const email = await biometricService.getUserEmail();

    if (!apiKey || !userId || !email) {
      return null;
    }

    const apiClient = getApiClient();
    apiClient.setApiKey(apiKey);

    try {
      await apiClient.validateApiKey();
      return { apiKey, userId, email };
    } catch {
      await biometricService.clearCredentials();
      return null;
    }
  }

  /**
   * Check if we have valid stored credentials.
   */
  async hasValidSession(): Promise<boolean> {
    try {
      const credentials = await this.getValidCredentials();
      return credentials !== null;
    } catch {
      return false;
    }
  }

  /**
   * Restore session from stored credentials.
   * Returns user info if successful.
   */
  async restoreSession(): Promise<CloudflareAccessResult> {
    const credentials = await this.getValidCredentials();

    if (!credentials) {
      return { success: false, error: "No valid credentials" };
    }

    return { success: true, ...credentials };
  }

  /**
   * Logout and clear all stored credentials.
   */
  async logout(): Promise<void> {
    const biometricService = getBiometricService();
    await biometricService.clearCredentials();

    const apiClient = getApiClient();
    apiClient.clearApiKey();
  }
}

// Singleton instance
let cfAccessService: CloudflareAccessService | null = null;

export function getCloudflareAccessService(): CloudflareAccessService {
  if (!cfAccessService) {
    const baseUrl = process.env.EXPO_PUBLIC_API_URL || "http://localhost:6001";
    cfAccessService = new CloudflareAccessService(baseUrl);
  }
  return cfAccessService;
}
