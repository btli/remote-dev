"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import type {
  AppearanceSettings,
  ResolvedAppearance,
  UpdateAppearanceInput,
  ColorSchemeId,
  AppearanceMode,
  ResolvedMode,
  ColorScheme,
} from "@/types/appearance";
import { DEFAULT_APPEARANCE } from "@/types/appearance";
import { getColorScheme, oklchToCSS } from "@/lib/color-schemes";

// =============================================================================
// Types
// =============================================================================

interface SchemePreview {
  id: ColorSchemeId;
  name: string;
  description: string;
  category: "cool" | "warm" | "neutral";
  isBuiltIn: boolean;
  sortOrder: number;
  preview: {
    light: { background: string; foreground: string; accent: string };
    dark: { background: string; foreground: string; accent: string };
  };
}

interface AppearanceContextValue {
  // State
  settings: AppearanceSettings | null;
  schemes: SchemePreview[];
  loading: boolean;
  error: string | null;

  // Computed
  appearance: ResolvedAppearance;
  /** Effective mode (resolved from system if needed) */
  effectiveMode: ResolvedMode;
  /** System preference (tracked separately) */
  systemMode: ResolvedMode;

  // Actions
  updateSettings: (updates: UpdateAppearanceInput) => Promise<void>;
  setMode: (mode: AppearanceMode) => Promise<void>;
  setLightScheme: (scheme: ColorSchemeId) => Promise<void>;
  setDarkScheme: (scheme: ColorSchemeId) => Promise<void>;

  // Utilities
  getScheme: (id: ColorSchemeId) => ColorScheme;
  refreshAppearance: () => Promise<void>;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

interface AppearanceProviderProps {
  children: ReactNode;
}

export function AppearanceProvider({ children }: AppearanceProviderProps) {
  const [settings, setSettings] = useState<AppearanceSettings | null>(null);
  const [schemes, setSchemes] = useState<SchemePreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [systemMode, setSystemMode] = useState<ResolvedMode>("dark");

  // Listen for system theme changes
  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemMode(mediaQuery.matches ? "dark" : "light");

    const handler = (e: MediaQueryListEvent) => {
      setSystemMode(e.matches ? "dark" : "light");
    };

    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  // Fetch appearance settings from API
  const refreshAppearance = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/appearance", { credentials: "include" });
      if (!res.ok) {
        if (res.status === 401) {
          // Not authenticated - expected during initial load
          return;
        }
        const errorBody = await res.json().catch(() => ({}));
        const errorMessage = errorBody.error || `Failed to fetch appearance (status: ${res.status})`;
        console.error("Appearance fetch failed:", errorMessage);
        setError(errorMessage);
        return;
      }
      const data = await res.json();
      setSettings(data.settings);
      setSchemes(data.schemes);
    } catch (err) {
      console.error("Error fetching appearance:", err);
      setError(err instanceof Error ? err.message : "Failed to load appearance");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    refreshAppearance();
  }, [refreshAppearance]);

  // Compute effective mode
  const effectiveMode = useMemo((): ResolvedMode => {
    const mode = settings?.appearanceMode ?? DEFAULT_APPEARANCE.appearanceMode;
    if (mode === "system") {
      return systemMode;
    }
    return mode;
  }, [settings?.appearanceMode, systemMode]);

  // Compute resolved appearance
  const appearance = useMemo((): ResolvedAppearance => {
    const currentSettings = settings ?? {
      ...DEFAULT_APPEARANCE,
      id: "",
      userId: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const schemeId = effectiveMode === "light"
      ? currentSettings.lightColorScheme
      : currentSettings.darkColorScheme;

    const colorScheme = getColorScheme(schemeId);

    return {
      mode: effectiveMode,
      colorScheme,
      isSystemMode: (settings?.appearanceMode ?? DEFAULT_APPEARANCE.appearanceMode) === "system",
      terminalOpacity: currentSettings.terminalOpacity,
      terminalBlur: currentSettings.terminalBlur,
      terminalCursorStyle: currentSettings.terminalCursorStyle,
    };
  }, [settings, effectiveMode]);

  // Apply theme to document
  useEffect(() => {
    if (typeof window === "undefined") return;

    const { mode, colorScheme } = appearance;
    const palette = colorScheme[mode].semantic;

    // Toggle dark class on document
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(mode);

    // Set scheme data attribute for CSS targeting
    document.documentElement.dataset.scheme = colorScheme.id;
    document.documentElement.dataset.mode = mode;

    // Apply CSS variables for semantic colors
    const root = document.documentElement.style;
    const colorMap: Record<string, keyof typeof palette> = {
      "--background": "background",
      "--foreground": "foreground",
      "--card": "card",
      "--card-foreground": "cardForeground",
      "--popover": "popover",
      "--popover-foreground": "popoverForeground",
      "--primary": "primary",
      "--primary-foreground": "primaryForeground",
      "--secondary": "secondary",
      "--secondary-foreground": "secondaryForeground",
      "--muted": "muted",
      "--muted-foreground": "mutedForeground",
      "--accent": "accent",
      "--accent-foreground": "accentForeground",
      "--destructive": "destructive",
      "--border": "border",
      "--input": "input",
      "--ring": "ring",
    };

    for (const [cssVar, paletteKey] of Object.entries(colorMap)) {
      root.setProperty(cssVar, oklchToCSS(palette[paletteKey]));
    }
  }, [appearance]);

  // Update settings
  const updateSettings = useCallback(async (updates: UpdateAppearanceInput) => {
    // Optimistic update
    setSettings((prev) => prev ? { ...prev, ...updates, updatedAt: new Date() } : prev);

    try {
      const res = await fetch("/api/appearance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
        credentials: "include",
      });

      if (!res.ok) {
        // Revert on error
        await refreshAppearance();
        const errorBody = await res.json().catch(() => ({}));
        throw new Error(errorBody.error || "Failed to update appearance");
      }

      const updated = await res.json();
      setSettings(updated);
    } catch (err) {
      // Revert on error
      await refreshAppearance();
      throw err;
    }
  }, [refreshAppearance]);

  // Convenience methods
  const setMode = useCallback(
    (mode: AppearanceMode) => updateSettings({ appearanceMode: mode }),
    [updateSettings]
  );

  const setLightScheme = useCallback(
    (scheme: ColorSchemeId) => updateSettings({ lightColorScheme: scheme }),
    [updateSettings]
  );

  const setDarkScheme = useCallback(
    (scheme: ColorSchemeId) => updateSettings({ darkColorScheme: scheme }),
    [updateSettings]
  );

  // Utility to get full scheme data
  const getSchemeUtil = useCallback((id: ColorSchemeId) => getColorScheme(id), []);

  const contextValue = useMemo(
    (): AppearanceContextValue => ({
      settings,
      schemes,
      loading,
      error,
      appearance,
      effectiveMode,
      systemMode,
      updateSettings,
      setMode,
      setLightScheme,
      setDarkScheme,
      getScheme: getSchemeUtil,
      refreshAppearance,
    }),
    [
      settings,
      schemes,
      loading,
      error,
      appearance,
      effectiveMode,
      systemMode,
      updateSettings,
      setMode,
      setLightScheme,
      setDarkScheme,
      getSchemeUtil,
      refreshAppearance,
    ]
  );

  return (
    <AppearanceContext.Provider value={contextValue}>
      {children}
    </AppearanceContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext);
  if (!context) {
    throw new Error("useAppearance must be used within AppearanceProvider");
  }
  return context;
}

/**
 * Hook to get the terminal theme for xterm.js
 * Returns the terminal palette and appearance settings.
 *
 * NOTE: Terminal always uses DARK palette regardless of site light/dark mode.
 * Many CLI tools and applications don't render well on light backgrounds,
 * so we always use the dark terminal palette for best compatibility.
 */
export function useTerminalTheme() {
  const { appearance } = useAppearance();
  return useMemo(() => {
    // Always use dark terminal palette - CLI tools work better on dark backgrounds
    const palette = appearance.colorScheme.dark.terminal;
    return {
      // Terminal palette for xterm.js ITheme
      ...palette,
      // Terminal appearance settings
      cursorStyle: appearance.terminalCursorStyle,
      opacity: appearance.terminalOpacity,
      blur: appearance.terminalBlur,
    };
  }, [appearance]);
}
