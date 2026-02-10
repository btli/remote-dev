import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

export type BiometricType = "FaceID" | "TouchID" | "Fingerprint" | "Iris" | "None";

interface BiometricAuthResult {
  success: boolean;
  error?: string;
}

const SECURE_KEYS = {
  API_KEY: "rdv_api_key",
  USER_ID: "rdv_user_id",
  USER_EMAIL: "rdv_user_email",
  BIOMETRIC_ENABLED: "rdv_biometric_enabled",
} as const;

/**
 * Biometric authentication and secure storage service.
 * Uses Face ID / Touch ID / Fingerprint with iOS Keychain / Android Keystore.
 */
export class BiometricService {
  /**
   * Check if biometric authentication is available on this device.
   */
  async isAvailable(): Promise<BiometricType> {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      if (!hasHardware) {
        return "None";
      }

      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!isEnrolled) {
        return "None";
      }

      const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();

      // Check for specific types
      if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        // On iOS, this is Face ID
        return "FaceID";
      }
      if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
        // On iOS this is Touch ID, on Android it's fingerprint
        return "TouchID";
      }
      if (supportedTypes.includes(LocalAuthentication.AuthenticationType.IRIS)) {
        return "Iris";
      }

      return "None";
    } catch (error) {
      console.error("[BiometricService] Error checking availability:", error);
      return "None";
    }
  }

  /**
   * Prompt for biometric authentication.
   */
  async authenticate(reason: string): Promise<BiometricAuthResult> {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: reason,
        cancelLabel: "Cancel",
        disableDeviceFallback: false, // Allow passcode fallback
        fallbackLabel: "Use Passcode",
      });

      // authenticateAsync handles both biometric and passcode fallback internally
      // When disableDeviceFallback is false, the system handles the fallback flow
      // and only returns success: true if the user successfully authenticated
      if (result.success) {
        return { success: true };
      }

      // Handle specific error cases
      if (result.error === "user_cancel") {
        return { success: false, error: "Authentication cancelled" };
      }
      if (result.error === "lockout") {
        return { success: false, error: "Too many failed attempts. Try again later." };
      }
      // Note: "user_fallback" with disableDeviceFallback: false means the system
      // is handling the passcode prompt - we should not see this error in that case.
      // If we do see it, treat as failure since auth is incomplete.

      return { success: false, error: result.error || "Authentication failed" };
    } catch (error) {
      console.error("[BiometricService] Authentication error:", error);
      return { success: false, error: "Authentication error" };
    }
  }

  /**
   * Check if biometric protection is enabled.
   */
  async isBiometricEnabled(): Promise<boolean> {
    try {
      const value = await SecureStore.getItemAsync(SECURE_KEYS.BIOMETRIC_ENABLED);
      return value === "true";
    } catch {
      return false;
    }
  }

  /**
   * Enable biometric protection for credentials.
   */
  async enableBiometric(): Promise<boolean> {
    try {
      // First verify biometric works
      const authResult = await this.authenticate("Enable biometric login for Remote Dev");
      if (!authResult.success) {
        return false;
      }

      await SecureStore.setItemAsync(SECURE_KEYS.BIOMETRIC_ENABLED, "true");
      return true;
    } catch (error) {
      console.error("[BiometricService] Error enabling biometric:", error);
      return false;
    }
  }

  /**
   * Disable biometric protection.
   */
  async disableBiometric(): Promise<void> {
    await SecureStore.setItemAsync(SECURE_KEYS.BIOMETRIC_ENABLED, "false");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Credential Storage
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Require biometric authentication if enabled.
   * Throws if authentication fails.
   */
  private async requireBiometricIfEnabled(reason: string): Promise<void> {
    const biometricEnabled = await this.isBiometricEnabled();
    if (!biometricEnabled) return;

    const authResult = await this.authenticate(reason);
    if (!authResult.success) {
      throw new Error(authResult.error || "Authentication required");
    }
  }

  /**
   * Store API key securely.
   * If biometric is enabled, requires authentication.
   */
  async storeApiKey(apiKey: string): Promise<void> {
    await this.requireBiometricIfEnabled("Authenticate to save API key");
    await SecureStore.setItemAsync(SECURE_KEYS.API_KEY, apiKey, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED,
    });
  }

  /**
   * Retrieve API key from secure storage.
   * If biometric is enabled, requires authentication.
   */
  async getApiKey(): Promise<string | null> {
    await this.requireBiometricIfEnabled("Authenticate to access Remote Dev");
    return await SecureStore.getItemAsync(SECURE_KEYS.API_KEY);
  }

  /**
   * Store user credentials securely.
   * If biometric is enabled, requires authentication first.
   */
  async storeCredentials(userId: string, email: string, apiKey: string): Promise<void> {
    await this.requireBiometricIfEnabled("Authenticate to save credentials");
    await Promise.all([
      SecureStore.setItemAsync(SECURE_KEYS.USER_ID, userId, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED,
      }),
      SecureStore.setItemAsync(SECURE_KEYS.USER_EMAIL, email, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED,
      }),
      SecureStore.setItemAsync(SECURE_KEYS.API_KEY, apiKey, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED,
      }),
    ]);
  }

  /**
   * Get stored user ID.
   */
  async getUserId(): Promise<string | null> {
    return await SecureStore.getItemAsync(SECURE_KEYS.USER_ID);
  }

  /**
   * Get stored user email.
   */
  async getUserEmail(): Promise<string | null> {
    return await SecureStore.getItemAsync(SECURE_KEYS.USER_EMAIL);
  }

  /**
   * Clear all stored credentials.
   */
  async clearCredentials(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(SECURE_KEYS.API_KEY),
      SecureStore.deleteItemAsync(SECURE_KEYS.USER_ID),
      SecureStore.deleteItemAsync(SECURE_KEYS.USER_EMAIL),
    ]);
  }

  /**
   * Check if credentials are stored.
   */
  async hasStoredCredentials(): Promise<boolean> {
    const apiKey = await SecureStore.getItemAsync(SECURE_KEYS.API_KEY);
    return apiKey !== null;
  }
}

// Singleton instance
let biometricService: BiometricService | null = null;

export function getBiometricService(): BiometricService {
  if (!biometricService) {
    biometricService = new BiometricService();
  }
  return biometricService;
}
