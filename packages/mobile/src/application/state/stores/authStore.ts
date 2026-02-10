import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface AuthState {
  isAuthenticated: boolean;
  userId: string | null;
  email: string | null;
  apiKey: string | null;
  biometricsEnabled: boolean;
  loading: boolean;
  error: Error | null;
}

interface AuthActions {
  // State mutations
  setAuthenticated: (userId: string, email: string) => void;
  setApiKey: (apiKey: string) => void;
  toggleBiometrics: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: Error | null) => void;

  // Auth actions
  login: (apiKey: string) => Promise<void>;
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
      apiKey: null, // This will be stored in SecureStore in production
      biometricsEnabled: false,
      loading: false,
      error: null,

      // State mutations
      setAuthenticated: (userId, email) =>
        set({ isAuthenticated: true, userId, email, error: null }),
      setApiKey: (apiKey) => set({ apiKey }),
      toggleBiometrics: () =>
        set((state) => ({ biometricsEnabled: !state.biometricsEnabled })),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error }),

      // Auth actions
      login: async (apiKey) => {
        set({ loading: true, error: null });
        try {
          // TODO: Validate API key with backend
          // const user = await apiClient.validateApiKey(apiKey);
          // set({ isAuthenticated: true, userId: user.id, email: user.email, apiKey });

          // Temporary: assume valid
          set({
            isAuthenticated: true,
            userId: "mock-user",
            email: "user@example.com",
            apiKey,
            loading: false,
          });
        } catch (error) {
          set({
            error: error instanceof Error ? error : new Error("Login failed"),
            loading: false,
          });
          throw error;
        }
      },

      loginWithCloudflareAccess: async () => {
        set({ loading: true, error: null });
        try {
          // TODO: Implement Cloudflare Access OAuth flow
          // 1. Open WebBrowser with CF Access URL
          // 2. Handle redirect with CF token
          // 3. Exchange CF token for API key
          // 4. Store API key in SecureStore

          // Temporary: simulate success
          set({
            isAuthenticated: true,
            userId: "cf-user",
            email: "cf-user@example.com",
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
        // TODO: Clear SecureStore credentials
        set({
          isAuthenticated: false,
          userId: null,
          email: null,
          apiKey: null,
          error: null,
        });
      },

      checkAuthStatus: async () => {
        try {
          // TODO: Check if we have valid credentials in SecureStore
          // If biometrics enabled, prompt for biometric auth
          // Then validate API key with backend

          const state = get();
          return state.isAuthenticated && !!state.apiKey;
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
