import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface ConfigState {
  serverUrl: string;
  wsUrl: string;
}

interface ConfigActions {
  setServerUrl: (url: string) => void;
  setWsUrl: (url: string) => void;
  getEffectiveServerUrl: () => string;
  getEffectiveWsUrl: () => string;
}

type ConfigStore = ConfigState & ConfigActions;

/**
 * Persistent configuration store.
 * Stores server URLs that override environment defaults.
 */
export const useConfigStore = create<ConfigStore>()(
  persist(
    (set, get) => ({
      serverUrl: "",
      wsUrl: "",

      setServerUrl: (url) => set({ serverUrl: url.replace(/\/+$/, "") }),
      setWsUrl: (url) => set({ wsUrl: url.replace(/\/+$/, "") }),

      getEffectiveServerUrl: () => {
        const stored = get().serverUrl;
        if (stored) return stored;
        return process.env.EXPO_PUBLIC_API_URL || "http://localhost:6001";
      },

      getEffectiveWsUrl: () => {
        const stored = get().wsUrl;
        if (stored) return stored;
        // Derive from server URL if not explicitly set
        const serverUrl = get().getEffectiveServerUrl();
        const wsProtocol = serverUrl.startsWith("https") ? "wss" : "ws";
        const host = serverUrl.replace(/^https?:\/\//, "");
        return process.env.EXPO_PUBLIC_WS_URL || `${wsProtocol}://${host}`;
      },
    }),
    {
      name: "config-storage",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
