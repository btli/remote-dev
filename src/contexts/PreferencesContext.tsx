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
  UserSettings,
  FolderPreferences,
  ResolvedPreferences,
  ActiveProject,
  UpdateUserSettingsInput,
  UpdateFolderPreferencesInput,
} from "@/types/preferences";
import { resolvePreferences } from "@/lib/preferences";

interface PreferencesContextValue {
  // State
  userSettings: UserSettings | null;
  folderPreferences: Map<string, FolderPreferences>;
  activeProject: ActiveProject;
  loading: boolean;

  // Computed
  currentPreferences: ResolvedPreferences;

  // User settings actions
  updateUserSettings: (updates: UpdateUserSettingsInput) => Promise<void>;

  // Folder preferences actions
  getFolderPreferences: (folderId: string) => FolderPreferences | null;
  updateFolderPreferences: (
    folderId: string,
    updates: UpdateFolderPreferencesInput
  ) => Promise<void>;
  deleteFolderPreferences: (folderId: string) => Promise<void>;
  hasFolderPreferences: (folderId: string) => boolean;

  // Active project management
  setActiveFolder: (folderId: string | null, pinned?: boolean) => void;
  resolvePreferencesForFolder: (folderId: string | null) => ResolvedPreferences;

  // Refresh
  refreshPreferences: () => Promise<void>;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

interface PreferencesProviderProps {
  children: ReactNode;
}

export function PreferencesProvider({ children }: PreferencesProviderProps) {
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [folderPreferences, setFolderPreferences] = useState<
    Map<string, FolderPreferences>
  >(new Map());
  const [activeProject, setActiveProject] = useState<ActiveProject>({
    folderId: null,
    folderName: null,
    isPinned: false,
  });
  const [loading, setLoading] = useState(true);

  const refreshPreferences = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch user settings
      const userRes = await fetch("/api/preferences");
      if (!userRes.ok) throw new Error("Failed to fetch user settings");
      const userData = await userRes.json();
      setUserSettings(userData.userSettings);

      // Set folder preferences map
      const folderMap = new Map<string, FolderPreferences>();
      if (userData.folderPreferences) {
        for (const pref of userData.folderPreferences) {
          folderMap.set(pref.folderId, pref);
        }
      }
      setFolderPreferences(folderMap);

      // Set active project
      const activeFolderId =
        userData.userSettings?.pinnedFolderId ||
        userData.userSettings?.activeFolderId;
      if (activeFolderId && userData.activeFolder) {
        setActiveProject({
          folderId: activeFolderId,
          folderName: userData.activeFolder.name,
          isPinned: !!userData.userSettings?.pinnedFolderId,
        });
      } else {
        setActiveProject({
          folderId: null,
          folderName: null,
          isPinned: false,
        });
      }
    } catch (error) {
      console.error("Error fetching preferences:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch preferences on mount
  useEffect(() => {
    refreshPreferences();
  }, [refreshPreferences]);

  const updateUserSettings = useCallback(
    async (updates: UpdateUserSettingsInput) => {
      if (!userSettings) return;

      // Optimistic update
      setUserSettings((prev) => (prev ? { ...prev, ...updates } : null));

      try {
        const response = await fetch("/api/preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });

        if (!response.ok) {
          await refreshPreferences();
          throw new Error("Failed to update user settings");
        }

        const updated = await response.json();
        setUserSettings(updated);
      } catch (error) {
        console.error("Error updating user settings:", error);
        throw error;
      }
    },
    [userSettings, refreshPreferences]
  );

  const getFolderPreferencesById = useCallback(
    (folderId: string): FolderPreferences | null => {
      return folderPreferences.get(folderId) || null;
    },
    [folderPreferences]
  );

  const hasFolderPreferences = useCallback(
    (folderId: string): boolean => {
      return folderPreferences.has(folderId);
    },
    [folderPreferences]
  );

  const updateFolderPreferencesHandler = useCallback(
    async (folderId: string, updates: UpdateFolderPreferencesInput) => {
      try {
        const response = await fetch(`/api/preferences/folders/${folderId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });

        if (!response.ok) {
          throw new Error("Failed to update folder preferences");
        }

        const updated = await response.json();
        setFolderPreferences((prev) => {
          const next = new Map(prev);
          next.set(folderId, updated);
          return next;
        });
      } catch (error) {
        console.error("Error updating folder preferences:", error);
        throw error;
      }
    },
    []
  );

  const deleteFolderPreferencesHandler = useCallback(
    async (folderId: string) => {
      try {
        const response = await fetch(`/api/preferences/folders/${folderId}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          throw new Error("Failed to delete folder preferences");
        }

        setFolderPreferences((prev) => {
          const next = new Map(prev);
          next.delete(folderId);
          return next;
        });
      } catch (error) {
        console.error("Error deleting folder preferences:", error);
        throw error;
      }
    },
    []
  );

  const resolvePreferencesForFolder = useCallback(
    (folderId: string | null): ResolvedPreferences => {
      const folderPrefs = folderId ? folderPreferences.get(folderId) || null : null;
      return resolvePreferences(userSettings, folderPrefs);
    },
    [userSettings, folderPreferences]
  );

  const setActiveFolder = useCallback(
    (folderId: string | null, pinned: boolean = false) => {
      // Update local state immediately
      setActiveProject((prev) => ({
        ...prev,
        folderId,
        isPinned: pinned,
      }));

      // Also update user settings
      if (userSettings) {
        setUserSettings({
          ...userSettings,
          activeFolderId: pinned ? null : folderId,
          pinnedFolderId: pinned ? folderId : null,
        });
      }

      // Persist to server (fire and forget, will sync on next load)
      fetch("/api/preferences/active-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId, pinned }),
      }).catch(console.error);
    },
    [userSettings]
  );

  // Compute current preferences based on active project
  const currentPreferences = useMemo(
    () => resolvePreferencesForFolder(activeProject.folderId),
    [activeProject.folderId, resolvePreferencesForFolder]
  );

  return (
    <PreferencesContext.Provider
      value={{
        userSettings,
        folderPreferences,
        activeProject,
        loading,
        currentPreferences,
        updateUserSettings,
        getFolderPreferences: getFolderPreferencesById,
        updateFolderPreferences: updateFolderPreferencesHandler,
        deleteFolderPreferences: deleteFolderPreferencesHandler,
        hasFolderPreferences,
        setActiveFolder,
        resolvePreferencesForFolder,
        refreshPreferences,
      }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferencesContext() {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error(
      "usePreferencesContext must be used within a PreferencesProvider"
    );
  }
  return context;
}
