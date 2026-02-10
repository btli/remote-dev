import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getCloudflareAccessService } from "@/infrastructure/auth/CloudflareAccessService";
import { getApiClient } from "@/infrastructure/api/RemoteDevApiClient";
import { getBiometricService } from "@/infrastructure/biometrics/BiometricService";

interface AuthState {
  isAuthenticated: boolean;
  userId: string | null;
  email: string | null;
  // NOTE: API key is NEVER stored in state - only in SecureStore via BiometricService
  biometricsEnabled: boolean;
  loading: boolean;
  error: Error | null;
}

interface AuthActions {
  // State mutations
  setAuthenticated: (userId: string, email: string) => void;
  clearAuth: () => void;
  toggleBiometrics: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: Error | null) => void;

  // Auth actions
  loginWithApiKey: (apiKey: string) => Promise<void>;
  loginWithCloudflareAccess: () => Promise<void>;
  logout: () => Promise<void>;
  checkAuthStatus: () => Promise<boolean>;
}

type AuthStore = AuthState & AuthActions;

/**
 * Auth store using Zustand with persistence.
 * Manages authentication state for the mobile app.
 *
 * Note: API keys are stored in SecureStore (see BiometricService)
 * This store only tracks auth status, not sensitive credentials.
 */
export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      // Initial state
      isAuthenticated: false,
      userId: null,
      email: null,
      biometricsEnabled: false,
      loading: false,
      error: null,

      // State mutations
      setAuthenticated: (userId, email) =>
        set({ isAuthenticated: true, userId, email, error: null }),
      clearAuth: () =>
        set({ isAuthenticated: false, userId: null, email: null, error: null }),
      toggleBiometrics: () =>
        set((state) => ({ biometricsEnabled: !state.biometricsEnabled })),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error }),

      // Auth actions
      loginWithApiKey: async (apiKey: string) => {
        set({ loading: true, error: null });
        try {
          // Validate the API key with the server
          const apiClient = getApiClient();
          apiClient.setApiKey(apiKey);
          const userInfo = await apiClient.validateApiKey();

          // Store credentials securely in SecureStore (NOT in state)
          const biometricService = getBiometricService();
          await biometricService.storeCredentials(
            userInfo.userId,
            userInfo.email,
            apiKey
          );

          set({
            isAuthenticated: true,
            userId: userInfo.userId,
            email: userInfo.email,
            loading: false,
          });
        } catch (error) {
          // Clear the invalid key from API client
          getApiClient().clearApiKey();
          set({
            error: error instanceof Error ? error : new Error("Invalid API key"),
            loading: false,
          });
          throw error;
        }
      },

      loginWithCloudflareAccess: async () => {
        set({ loading: true, error: null });
        try {
          // Use CloudflareAccessService for the actual OAuth flow
          // API key is stored in SecureStore, NOT in this state
          const cfService = getCloudflareAccessService();
          const result = await cfService.authenticate();

          if (!result.success) {
            throw new Error(result.error || "Authentication failed");
          }

          set({
            isAuthenticated: true,
            userId: result.userId || null,
            email: result.email || null,
            loading: false,
          });
        } catch (error) {
          set({
            error: error instanceof Error ? error : new Error("Cloudflare Access login failed"),
            loading: false,
          });
          throw error;
        }
      },

      logout: async () => {
        // Clear SecureStore credentials via CloudflareAccessService
        const cfService = getCloudflareAccessService();
        await cfService.logout();

        set({
          isAuthenticated: false,
          userId: null,
          email: null,
          error: null,
        });
      },

      checkAuthStatus: async () => {
        try {
          // Check if we have valid credentials in SecureStore
          const cfService = getCloudflareAccessService();
          const hasSession = await cfService.hasValidSession();

          if (hasSession) {
            const result = await cfService.restoreSession();
            if (result.success) {
              set({
                isAuthenticated: true,
                userId: result.userId || null,
                email: result.email || null,
              });
              return true;
            }
          }

          get().clearAuth();
          return false;
        } catch {
          return false;
        }
      },
    }),
    {
      name: "auth-storage",
      storage: createJSONStorage(() => AsyncStorage),
      // Don't persist sensitive data - only auth status
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        userId: state.userId,
        email: state.email,
        biometricsEnabled: state.biometricsEnabled,
      }),
    }
  )
);
