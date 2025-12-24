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
  FolderWithAncestry,
  ResolvedPreferences,
  ActiveProject,
  UpdateUserSettingsInput,
  UpdateFolderPreferencesInput,
} from "@/types/preferences";
import type { PortValidationResult } from "@/types/environment";
import {
  resolvePreferences,
  buildAncestryChain,
  isFromFolder,
} from "@/lib/preferences";
import { resolveEnvironmentVariables } from "@/lib/environment";

interface PreferencesContextValue {
  // State
  userSettings: UserSettings | null;
  folderPreferences: Map<string, FolderPreferences>;
  folders: Map<string, FolderWithAncestry>;
  activeProject: ActiveProject;
  loading: boolean;
  error: string | null;

  // Computed
  currentPreferences: ResolvedPreferences;

  // User settings actions
  updateUserSettings: (updates: UpdateUserSettingsInput) => Promise<void>;

  // Folder preferences actions
  getFolderPreferences: (folderId: string) => FolderPreferences | null;
  updateFolderPreferences: (
    folderId: string,
    updates: UpdateFolderPreferencesInput
  ) => Promise<PortValidationResult | undefined>;
  deleteFolderPreferences: (folderId: string) => Promise<void>;
  hasFolderPreferences: (folderId: string) => boolean;
  folderHasRepo: (folderId: string) => boolean;

  // Active project management
  setActiveFolder: (folderId: string | null, pinned?: boolean) => void;
  resolvePreferencesForFolder: (folderId: string | null) => ResolvedPreferences;
  getEnvironmentForFolder: (folderId: string | null) => Record<string, string> | null;

  // Utilities
  isFromFolder: typeof isFromFolder;

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
  const [folders, setFolders] = useState<Map<string, FolderWithAncestry>>(
    new Map()
  );
  const [activeProject, setActiveProject] = useState<ActiveProject>({
    folderId: null,
    folderName: null,
    isPinned: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshPreferences = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch user settings with credentials to ensure cookies are sent
      const userRes = await fetch("/api/preferences", {
        credentials: "include",
      });
      if (!userRes.ok) {
        // 401 during initial load is expected for unauthenticated users
        if (userRes.status === 401) {
          // Not authenticated - this is expected during initial load
          return;
        }
        // All other errors should be surfaced
        const errorBody = await userRes.json().catch(() => ({}));
        const errorMessage = errorBody.error || `Failed to fetch preferences (status: ${userRes.status})`;
        console.error("Preferences fetch failed:", errorMessage);
        setError(errorMessage);
        return;
      }
      const userData = await userRes.json();
      setUserSettings(userData.userSettings);

      // Set folder preferences map
      const folderPrefsMap = new Map<string, FolderPreferences>();
      if (userData.folderPreferences) {
        for (const pref of userData.folderPreferences) {
          folderPrefsMap.set(pref.folderId, pref);
        }
      }
      setFolderPreferences(folderPrefsMap);

      // Set folders map for hierarchy traversal
      const foldersMap = new Map<string, FolderWithAncestry>();
      if (userData.folders) {
        for (const folder of userData.folders) {
          foldersMap.set(folder.id, {
            id: folder.id,
            parentId: folder.parentId ?? null,
            name: folder.name,
          });
        }
      }
      setFolders(foldersMap);

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
    } catch (err) {
      console.error("Error fetching preferences:", err);
      setError(err instanceof Error ? err.message : "Failed to load preferences");
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

  /**
   * Check if a folder has a repository associated (directly or inherited from ancestors)
   */
  const folderHasRepo = useCallback(
    (folderId: string): boolean => {
      // Build the ancestry chain and check if any folder has a repo
      const chain = buildAncestryChain(folderId, folderPreferences, folders);
      return chain.some((prefs) => prefs.githubRepoId || prefs.localRepoPath);
    },
    [folderPreferences, folders]
  );

  const updateFolderPreferencesHandler = useCallback(
    async (folderId: string, updates: UpdateFolderPreferencesInput): Promise<PortValidationResult | undefined> => {
      try {
        const response = await fetch(`/api/preferences/folders/${folderId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });

        if (!response.ok) {
          throw new Error("Failed to update folder preferences");
        }

        const result = await response.json();
        // Extract portValidation from response (rest is the preferences)
        const { portValidation, ...preferences } = result;

        setFolderPreferences((prev) => {
          const next = new Map(prev);
          next.set(folderId, preferences);
          return next;
        });

        // Return port validation for UI to display warnings
        return portValidation as PortValidationResult | undefined;
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

  /**
   * Resolve preferences for a folder with hierarchical inheritance.
   * Walks up the parent chain and applies preferences from ancestors to descendants.
   */
  const resolvePreferencesForFolder = useCallback(
    (folderId: string | null): ResolvedPreferences => {
      if (!folderId) {
        return resolvePreferences(userSettings, []);
      }

      // Build the ancestry chain using the shared utility
      const chain = buildAncestryChain(folderId, folderPreferences, folders);

      // Use the shared resolution function
      return resolvePreferences(userSettings, chain);
    },
    [userSettings, folderPreferences, folders]
  );

  /**
   * Get resolved environment variables for a folder.
   * Returns the merged variables after applying hierarchy inheritance.
   */
  const getEnvironmentForFolder = useCallback(
    (folderId: string | null): Record<string, string> | null => {
      if (!folderId) return null;

      // Build the ancestry chain
      const chain = buildAncestryChain(folderId, folderPreferences, folders);

      // Resolve environment variables through the chain
      const resolved = resolveEnvironmentVariables(null, chain);
      return resolved?.variables ?? null;
    },
    [folderPreferences, folders]
  );

  const setActiveFolder = useCallback(
    (folderId: string | null, pinned: boolean = false) => {
      // Get folder name from our map
      const folder = folderId ? folders.get(folderId) : null;

      // Update local state immediately
      setActiveProject({
        folderId,
        folderName: folder?.name ?? null,
        isPinned: pinned,
      });

      // Also update user settings
      if (userSettings) {
        setUserSettings({
          ...userSettings,
          activeFolderId: pinned ? null : folderId,
          pinnedFolderId: pinned ? folderId : null,
        });
      }

      // Persist to server with proper error handling
      fetch("/api/preferences/active-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId, pinned }),
      })
        .then((res) => {
          if (!res.ok) {
            throw new Error(`Failed to save active folder (${res.status})`);
          }
        })
        .catch((err) => {
          console.error("Failed to persist active folder:", err);
          // Set error state so UI can display feedback
          setError("Failed to save active folder selection");
        });
    },
    [userSettings, folders]
  );

  // Compute current preferences based on active project
  const currentPreferences = useMemo(
    () => resolvePreferencesForFolder(activeProject.folderId),
    [activeProject.folderId, resolvePreferencesForFolder]
  );

  const contextValue = useMemo(
    () => ({
      userSettings,
      folderPreferences,
      folders,
      activeProject,
      loading,
      error,
      currentPreferences,
      updateUserSettings,
      getFolderPreferences: getFolderPreferencesById,
      updateFolderPreferences: updateFolderPreferencesHandler,
      deleteFolderPreferences: deleteFolderPreferencesHandler,
      hasFolderPreferences,
      folderHasRepo,
      setActiveFolder,
      resolvePreferencesForFolder,
      getEnvironmentForFolder,
      isFromFolder,
      refreshPreferences,
    }),
    [
      userSettings,
      folderPreferences,
      folders,
      activeProject,
      loading,
      error,
      currentPreferences,
      updateUserSettings,
      getFolderPreferencesById,
      updateFolderPreferencesHandler,
      deleteFolderPreferencesHandler,
      hasFolderPreferences,
      folderHasRepo,
      setActiveFolder,
      resolvePreferencesForFolder,
      getEnvironmentForFolder,
      refreshPreferences,
    ]
  );

  return (
    <PreferencesContext.Provider value={contextValue}>
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
