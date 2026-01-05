"use client";

/**
 * Profile Context
 *
 * Manages state for agent profiles and folder-profile links.
 * Provides methods to CRUD profiles and manage associated configs.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
} from "react";
import type {
  AgentProfile,
  CreateAgentProfileInput,
  UpdateAgentProfileInput,
  FolderProfileLink,
  GitIdentity,
  ProfileSecretsConfig,
  UpdateProfileSecretsConfigInput,
} from "@/types/agent";

interface ProfileContextValue {
  // State
  profiles: AgentProfile[];
  folderProfileLinks: Map<string, string>; // folderId -> profileId
  loading: boolean;
  error: string | null;

  // Profile CRUD
  getProfile: (profileId: string) => AgentProfile | null;
  getDefaultProfile: () => AgentProfile | null;
  getProfileForFolder: (folderId: string) => AgentProfile | null;
  createProfile: (input: CreateAgentProfileInput) => Promise<AgentProfile>;
  updateProfile: (id: string, input: UpdateAgentProfileInput) => Promise<AgentProfile>;
  deleteProfile: (id: string) => Promise<void>;
  setDefaultProfile: (id: string) => Promise<void>;

  // Folder-Profile Linking
  linkFolderToProfile: (folderId: string, profileId: string) => Promise<void>;
  unlinkFolderFromProfile: (folderId: string) => Promise<void>;

  // Git Identity
  getGitIdentity: (profileId: string) => Promise<GitIdentity | null>;
  setGitIdentity: (profileId: string, identity: GitIdentity) => Promise<void>;

  // Secrets Config
  getSecretsConfig: (profileId: string) => Promise<ProfileSecretsConfig | null>;
  setSecretsConfig: (
    profileId: string,
    input: UpdateProfileSecretsConfigInput
  ) => Promise<ProfileSecretsConfig>;
  deleteSecretsConfig: (profileId: string) => Promise<void>;
  toggleSecretsEnabled: (profileId: string, enabled: boolean) => Promise<void>;

  // Refresh
  refreshProfiles: () => Promise<void>;

  // Derived state
  hasProfiles: boolean;
  profileCount: number;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

interface ProfileProviderProps {
  children: ReactNode;
}

export function ProfileProvider({ children }: ProfileProviderProps) {
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [folderProfileLinks, setFolderProfileLinks] = useState<Map<string, string>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initial fetch on mount
  const refreshProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/profiles");
      if (!response.ok) {
        throw new Error(`Failed to fetch profiles: ${response.statusText}`);
      }

      const data = await response.json();
      const profileList: AgentProfile[] = data.profiles || [];
      const rawLinks = data.folderLinks || [];

      // Handle both array format (new) and object format (legacy) for folderLinks
      const linksMap: Map<string, string> = Array.isArray(rawLinks)
        ? new Map(rawLinks.map((l: FolderProfileLink) => [l.folderId, l.profileId]))
        : new Map(Object.entries(rawLinks));

      setProfiles(profileList);
      setFolderProfileLinks(linksMap);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      console.error("Failed to fetch profiles:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch profiles on mount
  useEffect(() => {
    refreshProfiles();
  }, [refreshProfiles]);

  const getProfile = useCallback(
    (profileId: string): AgentProfile | null => {
      return profiles.find((p) => p.id === profileId) || null;
    },
    [profiles]
  );

  const getDefaultProfile = useCallback((): AgentProfile | null => {
    return profiles.find((p) => p.isDefault) || null;
  }, [profiles]);

  const getProfileForFolder = useCallback(
    (folderId: string): AgentProfile | null => {
      const profileId = folderProfileLinks.get(folderId);
      if (!profileId) return null;
      return profiles.find((p) => p.id === profileId) || null;
    },
    [profiles, folderProfileLinks]
  );

  const createProfile = useCallback(
    async (input: CreateAgentProfileInput): Promise<AgentProfile> => {
      const response = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to create profile");
      }

      const created: AgentProfile = await response.json();

      // Update local state
      setProfiles((prev) => {
        // If new profile is default, unset other defaults
        if (created.isDefault) {
          return [...prev.map((p) => ({ ...p, isDefault: false })), created];
        }
        return [...prev, created];
      });

      return created;
    },
    []
  );

  const updateProfile = useCallback(
    async (id: string, input: UpdateAgentProfileInput): Promise<AgentProfile> => {
      const response = await fetch(`/api/profiles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to update profile");
      }

      const updated: AgentProfile = await response.json();

      // Update local state
      setProfiles((prev) => {
        return prev.map((p) => {
          if (p.id === id) return updated;
          // If updated profile is now default, unset others
          if (updated.isDefault && p.isDefault) {
            return { ...p, isDefault: false };
          }
          return p;
        });
      });

      return updated;
    },
    []
  );

  const deleteProfile = useCallback(async (id: string): Promise<void> => {
    const response = await fetch(`/api/profiles/${id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to delete profile");
    }

    // Update local state
    setProfiles((prev) => prev.filter((p) => p.id !== id));

    // Remove any folder links to this profile
    setFolderProfileLinks((prev) => {
      const next = new Map(prev);
      for (const [folderId, profileId] of next) {
        if (profileId === id) {
          next.delete(folderId);
        }
      }
      return next;
    });
  }, []);

  const setDefaultProfile = useCallback(
    async (id: string): Promise<void> => {
      await updateProfile(id, { isDefault: true });
    },
    [updateProfile]
  );

  const linkFolderToProfile = useCallback(
    async (folderId: string, profileId: string): Promise<void> => {
      const response = await fetch(`/api/profiles/folders/${folderId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to link folder to profile");
      }

      // Update local state
      setFolderProfileLinks((prev) => {
        const next = new Map(prev);
        next.set(folderId, profileId);
        return next;
      });
    },
    []
  );

  const unlinkFolderFromProfile = useCallback(
    async (folderId: string): Promise<void> => {
      const response = await fetch(`/api/profiles/folders/${folderId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to unlink folder from profile");
      }

      // Update local state
      setFolderProfileLinks((prev) => {
        const next = new Map(prev);
        next.delete(folderId);
        return next;
      });
    },
    []
  );

  const getGitIdentity = useCallback(
    async (profileId: string): Promise<GitIdentity | null> => {
      const response = await fetch(`/api/profiles/${profileId}/git-identity`);

      if (!response.ok) {
        if (response.status === 404) return null;
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to fetch git identity");
      }

      // API returns GitIdentity directly, not wrapped in { identity: ... }
      return await response.json();
    },
    []
  );

  const setGitIdentity = useCallback(
    async (profileId: string, identity: GitIdentity): Promise<void> => {
      const response = await fetch(`/api/profiles/${profileId}/git-identity`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(identity),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to set git identity");
      }
    },
    []
  );

  const getSecretsConfig = useCallback(
    async (profileId: string): Promise<ProfileSecretsConfig | null> => {
      const response = await fetch(`/api/profiles/${profileId}/secrets`);

      if (!response.ok) {
        if (response.status === 404) return null;
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to fetch secrets config");
      }

      // API returns ProfileSecretsConfig directly, not wrapped in { config: ... }
      return await response.json();
    },
    []
  );

  const setSecretsConfig = useCallback(
    async (
      profileId: string,
      input: UpdateProfileSecretsConfigInput
    ): Promise<ProfileSecretsConfig> => {
      const response = await fetch(`/api/profiles/${profileId}/secrets`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to set secrets config");
      }

      return await response.json();
    },
    []
  );

  const deleteSecretsConfig = useCallback(
    async (profileId: string): Promise<void> => {
      const response = await fetch(`/api/profiles/${profileId}/secrets`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to delete secrets config");
      }
    },
    []
  );

  const toggleSecretsEnabled = useCallback(
    async (profileId: string, enabled: boolean): Promise<void> => {
      const response = await fetch(`/api/profiles/${profileId}/secrets`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to toggle secrets enabled");
      }
    },
    []
  );

  const hasProfiles = profiles.length > 0;
  const profileCount = profiles.length;

  const value = useMemo<ProfileContextValue>(
    () => ({
      profiles,
      folderProfileLinks,
      loading,
      error,
      getProfile,
      getDefaultProfile,
      getProfileForFolder,
      createProfile,
      updateProfile,
      deleteProfile,
      setDefaultProfile,
      linkFolderToProfile,
      unlinkFolderFromProfile,
      getGitIdentity,
      setGitIdentity,
      getSecretsConfig,
      setSecretsConfig,
      deleteSecretsConfig,
      toggleSecretsEnabled,
      refreshProfiles,
      hasProfiles,
      profileCount,
    }),
    [
      profiles,
      folderProfileLinks,
      loading,
      error,
      getProfile,
      getDefaultProfile,
      getProfileForFolder,
      createProfile,
      updateProfile,
      deleteProfile,
      setDefaultProfile,
      linkFolderToProfile,
      unlinkFolderFromProfile,
      getGitIdentity,
      setGitIdentity,
      getSecretsConfig,
      setSecretsConfig,
      deleteSecretsConfig,
      toggleSecretsEnabled,
      refreshProfiles,
      hasProfiles,
      profileCount,
    ]
  );

  return (
    <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
  );
}

export function useProfileContext(): ProfileContextValue {
  const context = useContext(ProfileContext);
  if (!context) {
    throw new Error("useProfileContext must be used within ProfileProvider");
  }
  return context;
}

/**
 * Hook to get profile for a specific folder
 */
export function useFolderProfile(folderId: string | null): {
  profile: AgentProfile | null;
  loading: boolean;
} {
  const { getProfileForFolder, loading } = useProfileContext();

  const profile = useMemo(
    () => (folderId ? getProfileForFolder(folderId) : null),
    [folderId, getProfileForFolder]
  );

  return { profile, loading };
}

/**
 * Hook to get profile by ID
 */
export function useProfile(profileId: string | null): {
  profile: AgentProfile | null;
  loading: boolean;
} {
  const { getProfile, loading } = useProfileContext();

  const profile = useMemo(
    () => (profileId ? getProfile(profileId) : null),
    [profileId, getProfile]
  );

  return { profile, loading };
}
