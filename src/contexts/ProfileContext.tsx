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
import type {
  LimitStateBlock,
  ClaudePoolSummary,
  ClaudePoolDetail,
  ProfileLimitChangedEvent,
} from "@/types/claude-limits";

import { apiFetch } from "@/lib/api-fetch";
import { useProfileLimitSocket } from "@/hooks/useProfileLimitSocket";

interface ProfileContextValue {
  // State
  profiles: AgentProfile[];
  folderProfileLinks: Map<string, string>; // folderId -> profileId
  loading: boolean;
  error: string | null;

  // Claude usage-limit state [remote-dev-0yix]
  /** profileId -> serialized limit-state block (seeded from GET /api/profiles,
   *  updated live via the `profile_limit_changed` WS event). */
  limitStates: Map<string, LimitStateBlock>;
  getLimitState: (profileId: string) => LimitStateBlock | null;
  /** Manual override: clear a profile's limit (PATCH /api/profiles/:id/limit-state). */
  markProfileAvailable: (profileId: string) => Promise<void>;

  // Claude fallback pools [remote-dev-0yix] — thin wrappers over the pool routes.
  pools: ClaudePoolSummary[];
  refreshPools: () => Promise<void>;
  createPool: (name: string) => Promise<ClaudePoolSummary>;
  renamePool: (poolId: string, name: string) => Promise<void>;
  deletePool: (poolId: string) => Promise<void>;
  getPoolDetail: (poolId: string) => Promise<ClaudePoolDetail>;
  addPoolMember: (
    poolId: string,
    profileId: string,
    priority?: number
  ) => Promise<void>;
  removePoolMember: (poolId: string, profileId: string) => Promise<void>;

  /** Recommended profile for a project (primary → fallback pool with rotation). */
  getRecommendedProfile: (
    projectId: string
  ) => Promise<{ profileId: string | null; wasAutoSelected: boolean }>;

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
  const [limitStates, setLimitStates] = useState<Map<string, LimitStateBlock>>(
    new Map()
  );
  const [pools, setPools] = useState<ClaudePoolSummary[]>([]);

  // Initial fetch on mount
  const refreshProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiFetch("/api/profiles");
      if (!response.ok) {
        throw new Error(`Failed to fetch profiles: ${response.statusText}`);
      }

      const data = await response.json();
      // The route augments each profile with `limitState` + `accountKind`
      // (additive — see GET /api/profiles). We keep `profiles` typed as
      // AgentProfile and lift `limitState` into its own map.
      const rawProfiles: (AgentProfile & {
        limitState?: LimitStateBlock;
      })[] = data.profiles || [];
      const profileList: AgentProfile[] = rawProfiles;
      const rawLinks = data.folderLinks || [];

      // Handle both array format (new) and object format (legacy) for folderLinks
      const linksMap: Map<string, string> = Array.isArray(rawLinks)
        ? new Map(rawLinks.map((l: FolderProfileLink) => [l.projectId, l.profileId]))
        : new Map(Object.entries(rawLinks));

      // Seed the limit-state cache from the augmented payload. Live updates
      // arrive via the `profile_limit_changed` WS event (below).
      const seededLimits = new Map<string, LimitStateBlock>();
      for (const p of rawProfiles) {
        if (p.limitState) seededLimits.set(p.id, p.limitState);
      }

      setProfiles(profileList);
      setFolderProfileLinks(linksMap);
      setLimitStates(seededLimits);
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

  // ───────────────────────────────────────────────────────────────────────
  // Claude usage-limit state [remote-dev-0yix]
  // ───────────────────────────────────────────────────────────────────────

  const getLimitState = useCallback(
    (profileId: string): LimitStateBlock | null =>
      limitStates.get(profileId) ?? null,
    [limitStates]
  );

  // Live updates: fold each `profile_limit_changed` broadcast into the map.
  // The WS payload carries ISO-string reset timestamps; convert to epoch-ms to
  // match the seeded REST shape so downstream countdown math is uniform.
  const onLimitChanged = useCallback((event: ProfileLimitChangedEvent) => {
    const resetAt5h = event.resetAt5h ? Date.parse(event.resetAt5h) : null;
    const resetAt7d = event.resetAt7d ? Date.parse(event.resetAt7d) : null;
    const candidates = [resetAt5h, resetAt7d].filter(
      (n): n is number => n !== null && Number.isFinite(n)
    );
    const effectiveResetAt = candidates.length ? Math.min(...candidates) : null;
    setLimitStates((prev) => {
      const next = new Map(prev);
      next.set(event.profileId, {
        limitStatus: event.limitStatus,
        window5hPct: event.window5hPct,
        window7dPct: event.window7dPct,
        resetAt5h: resetAt5h !== null && Number.isFinite(resetAt5h) ? resetAt5h : null,
        resetAt7d: resetAt7d !== null && Number.isFinite(resetAt7d) ? resetAt7d : null,
        effectiveResetAt,
      });
      return next;
    });
  }, []);

  useProfileLimitSocket({ onLimitChanged });

  const markProfileAvailable = useCallback(
    async (profileId: string): Promise<void> => {
      const response = await apiFetch(
        `/api/profiles/${profileId}/limit-state`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "available" }),
        }
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to clear limit");
      }
      const cleared: LimitStateBlock = await response.json();
      setLimitStates((prev) => {
        const next = new Map(prev);
        next.set(profileId, cleared);
        return next;
      });
    },
    []
  );

  // ───────────────────────────────────────────────────────────────────────
  // Claude fallback pools [remote-dev-0yix] — thin wrappers over the routes.
  // ───────────────────────────────────────────────────────────────────────

  const refreshPools = useCallback(async (): Promise<void> => {
    const response = await apiFetch("/api/claude-pools");
    if (!response.ok) {
      // Pools are an optional layer; never throw on read (keep the dashboard
      // usable when no pools exist / the route is unavailable).
      console.error("Failed to fetch pools:", response.status);
      return;
    }
    const data = await response.json();
    setPools((data.pools as ClaudePoolSummary[]) ?? []);
  }, []);

  // Load pools once on mount alongside profiles.
  useEffect(() => {
    void refreshPools();
  }, [refreshPools]);

  const createPool = useCallback(
    async (name: string): Promise<ClaudePoolSummary> => {
      const response = await apiFetch("/api/claude-pools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to create pool");
      }
      const created: ClaudePoolSummary = await response.json();
      setPools((prev) => [...prev, created]);
      return created;
    },
    []
  );

  const renamePool = useCallback(
    async (poolId: string, name: string): Promise<void> => {
      const response = await apiFetch(`/api/claude-pools/${poolId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to rename pool");
      }
      setPools((prev) =>
        prev.map((p) => (p.id === poolId ? { ...p, name } : p))
      );
    },
    []
  );

  const deletePool = useCallback(
    async (poolId: string): Promise<void> => {
      const response = await apiFetch(`/api/claude-pools/${poolId}`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 204) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to delete pool");
      }
      setPools((prev) => prev.filter((p) => p.id !== poolId));
    },
    []
  );

  const getPoolDetail = useCallback(
    async (poolId: string): Promise<ClaudePoolDetail> => {
      const response = await apiFetch(`/api/claude-pools/${poolId}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to load pool");
      }
      return (await response.json()) as ClaudePoolDetail;
    },
    []
  );

  const addPoolMember = useCallback(
    async (
      poolId: string,
      profileId: string,
      priority?: number
    ): Promise<void> => {
      const response = await apiFetch(
        `/api/claude-pools/${poolId}/members`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            priority === undefined ? { profileId } : { profileId, priority }
          ),
        }
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to add pool member");
      }
      // Keep the cheap member count in sync for the summary list.
      void refreshPools();
    },
    [refreshPools]
  );

  const removePoolMember = useCallback(
    async (poolId: string, profileId: string): Promise<void> => {
      const response = await apiFetch(
        `/api/claude-pools/${poolId}/members?profileId=${encodeURIComponent(profileId)}`,
        { method: "DELETE" }
      );
      if (!response.ok && response.status !== 204) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to remove pool member");
      }
      void refreshPools();
    },
    [refreshPools]
  );

  const getRecommendedProfile = useCallback(
    async (
      projectId: string
    ): Promise<{ profileId: string | null; wasAutoSelected: boolean }> => {
      try {
        const response = await apiFetch(
          `/api/profiles/select?projectId=${encodeURIComponent(projectId)}`
        );
        if (!response.ok) {
          return { profileId: null, wasAutoSelected: false };
        }
        const data = await response.json();
        return {
          profileId: (data.profileId as string | null) ?? null,
          wasAutoSelected: Boolean(data.wasAutoSelected),
        };
      } catch (err) {
        // Best-effort pre-fill: never block the wizard on a failed lookup.
        console.error("Failed to resolve recommended profile:", err);
        return { profileId: null, wasAutoSelected: false };
      }
    },
    []
  );

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
      const response = await apiFetch("/api/profiles", {
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
      const response = await apiFetch(`/api/profiles/${id}`, {
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
    const response = await apiFetch(`/api/profiles/${id}`, {
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
      const response = await apiFetch(`/api/profiles/folders/${folderId}`, {
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
      const response = await apiFetch(`/api/profiles/folders/${folderId}`, {
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
      const response = await apiFetch(`/api/profiles/${profileId}/git-identity`);

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
      const response = await apiFetch(`/api/profiles/${profileId}/git-identity`, {
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
      const response = await apiFetch(`/api/profiles/${profileId}/secrets`);

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
      const response = await apiFetch(`/api/profiles/${profileId}/secrets`, {
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
      const response = await apiFetch(`/api/profiles/${profileId}/secrets`, {
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
      const response = await apiFetch(`/api/profiles/${profileId}/secrets`, {
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
      limitStates,
      getLimitState,
      markProfileAvailable,
      pools,
      refreshPools,
      createPool,
      renamePool,
      deletePool,
      getPoolDetail,
      addPoolMember,
      removePoolMember,
      getRecommendedProfile,
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
      limitStates,
      getLimitState,
      markProfileAvailable,
      pools,
      refreshPools,
      createPool,
      renamePool,
      deletePool,
      getPoolDetail,
      addPoolMember,
      removePoolMember,
      getRecommendedProfile,
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
