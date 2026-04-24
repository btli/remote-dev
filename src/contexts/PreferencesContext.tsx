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
import {
  resolvePreferences,
  buildAncestryChain,
  isFromFolder,
} from "@/lib/preferences";
import { resolveEnvironmentVariables } from "@/lib/environment";

interface PreferencesContextValue {
  // State
  userSettings: UserSettings | null;
  activeProject: ActiveProject;
  loading: boolean;
  error: string | null;

  // Computed
  currentPreferences: ResolvedPreferences;

  // User settings actions
  updateUserSettings: (updates: UpdateUserSettingsInput) => Promise<void>;

  // Node-keyed preference actions. ownerType discriminates between a group
  // and a project node in the project tree. The underlying DB state is
  // keyed by (ownerType, ownerId) in the `node_preferences` table, but the
  // in-memory state is keyed by `ownerId` alone — collisions are
  // impossible since both project and group ids are UUIDs.
  getNodePreferences: (
    ownerType: "group" | "project",
    ownerId: string
  ) => FolderPreferences | null;
  hasNodePreferences: (
    ownerType: "group" | "project",
    ownerId: string
  ) => boolean;
  nodeHasRepo: (ownerType: "group" | "project", ownerId: string) => boolean;

  // Update/delete currently only target projects (groups own preferences
  // too, but mutation is driven by the `group-prefs` terminal-tab plugin
  // directly via the /api/node-preferences/group/:id route).
  updateFolderPreferences: (
    projectId: string,
    updates: UpdateFolderPreferencesInput
  ) => Promise<void>;
  deleteFolderPreferences: (projectId: string) => Promise<void>;

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
  // Preferences keyed by ownerId (project or group UUID — unique across both
  // tables). The original `folderPreferences` name referred to the legacy
  // folders table; post-migration this stores rows from node_preferences.
  const [nodePreferences, setNodePreferences] = useState<
    Map<string, FolderPreferences>
  >(new Map());
  // Flattened ancestry map (groups + projects) used to resolve inherited
  // preferences. Each entry stores the node's parent id so we can walk
  // upward to the root.
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

      // Set node preferences map. The API still serializes the payload
      // under `folderPreferences` for back-compat; each row is keyed by
      // the owner id (project or group UUID).
      const nodePrefsMap = new Map<string, FolderPreferences>();
      if (userData.folderPreferences) {
        for (const pref of userData.folderPreferences) {
          nodePrefsMap.set(pref.folderId, pref);
        }
      }
      setNodePreferences(nodePrefsMap);

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

      // Set active project. After the project refactor, the API returns
      // `pinnedNodeId` / `activeNodeId` on userSettings (replacing the
      // legacy `pinnedFolderId` / `activeFolderId` fields).
      const activeNodeId =
        userData.userSettings?.pinnedNodeId ||
        userData.userSettings?.activeNodeId;
      if (activeNodeId && userData.activeFolder) {
        setActiveProject({
          folderId: activeNodeId,
          folderName: userData.activeFolder.name,
          isPinned: !!userData.userSettings?.pinnedNodeId,
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

  // Node-keyed accessors. The owner discriminator is accepted for API
  // symmetry and future-proofing but is currently ignored because `ownerId`
  // alone uniquely identifies a row in the shared preferences map (project
  // and group ids are both UUIDs and never collide).
  const getNodePreferences = useCallback(
    (_ownerType: "group" | "project", ownerId: string): FolderPreferences | null => {
      return nodePreferences.get(ownerId) || null;
    },
    [nodePreferences]
  );

  const hasNodePreferences = useCallback(
    (_ownerType: "group" | "project", ownerId: string): boolean => {
      return nodePreferences.has(ownerId);
    },
    [nodePreferences]
  );

  const nodeHasRepo = useCallback(
    (_ownerType: "group" | "project", ownerId: string): boolean => {
      const chain = buildAncestryChain(ownerId, nodePreferences, folders);
      return chain.some((prefs) => prefs.githubRepoId || prefs.localRepoPath);
    },
    [nodePreferences, folders]
  );

  const updateFolderPreferencesHandler = useCallback(
    async (folderId: string, updates: UpdateFolderPreferencesInput): Promise<void> => {
      try {
        // Route through the node-keyed preferences API. The legacy
        // /api/preferences/folders/:id route no longer exists; all state is
        // keyed on project id post-migration.
        const response = await fetch(`/api/node-preferences/project/${folderId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });

        if (!response.ok) {
          throw new Error("Failed to update folder preferences");
        }

        // Optimistically merge the applied updates into the local map so
        // consumers see the change without a full refresh. The node-
        // preferences PUT response is `{ ok: true }` and does not echo the
        // merged record, so we fold updates in manually.
        setNodePreferences((prev) => {
          const next = new Map(prev);
          const existing = next.get(folderId);
          const merged: FolderPreferences = {
            ...(existing ?? { folderId }),
            ...updates,
          } as FolderPreferences;
          next.set(folderId, merged);
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
        const response = await fetch(`/api/node-preferences/project/${folderId}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          throw new Error("Failed to delete folder preferences");
        }

        setNodePreferences((prev) => {
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
      const chain = buildAncestryChain(folderId, nodePreferences, folders);

      // Use the shared resolution function
      return resolvePreferences(userSettings, chain);
    },
    [userSettings, nodePreferences, folders]
  );

  /**
   * Get resolved environment variables for a folder.
   * Returns the merged variables after applying hierarchy inheritance.
   */
  const getEnvironmentForFolder = useCallback(
    (folderId: string | null): Record<string, string> | null => {
      if (!folderId) return null;

      // Build the ancestry chain
      const chain = buildAncestryChain(folderId, nodePreferences, folders);

      // Resolve environment variables through the chain
      const resolved = resolveEnvironmentVariables(null, chain);
      return resolved?.variables ?? null;
    },
    [nodePreferences, folders]
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
          activeNodeId: pinned ? null : folderId,
          activeNodeType: pinned ? null : (folderId ? "project" : null),
          pinnedNodeId: pinned ? folderId : null,
          pinnedNodeType: pinned ? (folderId ? "project" : null) : null,
        });
      }

      // Persist to server with proper error handling. The legacy
      // /api/preferences/active-folder endpoint is gone — the node-keyed
      // endpoint accepts `{ nodeId, nodeType, pinned }`. When clearing the
      // selection (`folderId === null`) both fields are null. Until group
      // nodes are supported in the active-node UI, any non-null folderId is
      // treated as a project id.
      fetch("/api/preferences/active-node", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId: folderId,
          nodeType: folderId ? "project" : null,
          pinned,
        }),
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
      activeProject,
      loading,
      error,
      currentPreferences,
      updateUserSettings,
      updateFolderPreferences: updateFolderPreferencesHandler,
      deleteFolderPreferences: deleteFolderPreferencesHandler,
      getNodePreferences,
      hasNodePreferences,
      nodeHasRepo,
      setActiveFolder,
      resolvePreferencesForFolder,
      getEnvironmentForFolder,
      isFromFolder,
      refreshPreferences,
    }),
    [
      userSettings,
      activeProject,
      loading,
      error,
      currentPreferences,
      updateUserSettings,
      updateFolderPreferencesHandler,
      deleteFolderPreferencesHandler,
      getNodePreferences,
      hasNodePreferences,
      nodeHasRepo,
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
