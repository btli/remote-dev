"use client";

import { useState, useCallback, useEffect } from "react";
import type { AgentJsonConfig, AgentConfigType } from "@/types/agent-config";
import { getDefaultConfig } from "@/types/agent-config";

interface AgentProfile {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface AgentProfileConfig {
  id: string;
  profileId: string;
  agentType: AgentConfigType;
  configJson: AgentJsonConfig;
  isValid: boolean;
  validationErrors?: string[];
  createdAt: Date;
  updatedAt: Date;
}

interface ProfileWithConfigs extends AgentProfile {
  configs: Record<AgentConfigType, AgentProfileConfig | undefined>;
}

interface UseAgentProfilesResult {
  profiles: AgentProfile[];
  activeProfile: ProfileWithConfigs | null;
  isLoading: boolean;
  error: string | null;
  fetchProfiles: () => Promise<void>;
  fetchProfile: (id: string) => Promise<ProfileWithConfigs | null>;
  createProfile: (name: string, description?: string) => Promise<AgentProfile | null>;
  updateProfile: (id: string, updates: Partial<AgentProfile>) => Promise<AgentProfile | null>;
  deleteProfile: (id: string) => Promise<boolean>;
  cloneProfile: (id: string, newName: string) => Promise<AgentProfile | null>;
  setActiveProfile: (id: string | null) => void;
  getConfig: (profileId: string, agentType: AgentConfigType) => Promise<AgentProfileConfig | null>;
  saveConfig: (
    profileId: string,
    agentType: AgentConfigType,
    configJson: AgentJsonConfig
  ) => Promise<AgentProfileConfig | null>;
  exportProfile: (id: string) => Promise<string | null>;
  importProfile: (data: string) => Promise<AgentProfile | null>;
}

/**
 * Hook for managing agent profiles and their configurations
 */
export function useAgentProfiles(): UseAgentProfilesResult {
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [activeProfile, setActiveProfileState] = useState<ProfileWithConfigs | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfiles = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agent-profiles");
      if (!res.ok) throw new Error("Failed to fetch profiles");
      const data = await res.json();
      setProfiles(data.profiles || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch profiles");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchProfile = useCallback(async (id: string): Promise<ProfileWithConfigs | null> => {
    try {
      const [profileRes, configsRes] = await Promise.all([
        fetch(`/api/agent-profiles/${id}`),
        fetch(`/api/agent-profiles/${id}/configs`),
      ]);

      if (!profileRes.ok) return null;

      const profileData = await profileRes.json();
      const configsData = configsRes.ok ? await configsRes.json() : { configs: [] };

      const configs: Record<AgentConfigType, AgentProfileConfig | undefined> = {
        claude: undefined,
        gemini: undefined,
        opencode: undefined,
        codex: undefined,
      };

      for (const config of configsData.configs || []) {
        configs[config.agentType as AgentConfigType] = {
          ...config,
          configJson: typeof config.configJson === "string"
            ? JSON.parse(config.configJson)
            : config.configJson,
        };
      }

      return {
        ...profileData.profile,
        configs,
      };
    } catch {
      return null;
    }
  }, []);

  const createProfile = useCallback(async (
    name: string,
    description?: string
  ): Promise<AgentProfile | null> => {
    try {
      const res = await fetch("/api/agent-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });

      if (!res.ok) return null;
      const data = await res.json();
      setProfiles((prev) => [...prev, data.profile]);
      return data.profile;
    } catch {
      return null;
    }
  }, []);

  const updateProfile = useCallback(async (
    id: string,
    updates: Partial<AgentProfile>
  ): Promise<AgentProfile | null> => {
    try {
      const res = await fetch(`/api/agent-profiles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (!res.ok) return null;
      const data = await res.json();
      setProfiles((prev) =>
        prev.map((p) => (p.id === id ? { ...p, ...data.profile } : p))
      );
      return data.profile;
    } catch {
      return null;
    }
  }, []);

  const deleteProfile = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/agent-profiles/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) return false;
      setProfiles((prev) => prev.filter((p) => p.id !== id));
      if (activeProfile?.id === id) {
        setActiveProfileState(null);
      }
      return true;
    } catch {
      return false;
    }
  }, [activeProfile?.id]);

  const cloneProfile = useCallback(async (
    id: string,
    newName: string
  ): Promise<AgentProfile | null> => {
    try {
      const res = await fetch(`/api/agent-profiles/${id}/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });

      if (!res.ok) return null;
      const data = await res.json();
      setProfiles((prev) => [...prev, data.profile]);
      return data.profile;
    } catch {
      return null;
    }
  }, []);

  const setActiveProfile = useCallback(async (id: string | null) => {
    if (!id) {
      setActiveProfileState(null);
      return;
    }

    const profile = await fetchProfile(id);
    setActiveProfileState(profile);
  }, [fetchProfile]);

  const getConfig = useCallback(async (
    profileId: string,
    agentType: AgentConfigType
  ): Promise<AgentProfileConfig | null> => {
    try {
      const res = await fetch(`/api/agent-profiles/${profileId}/configs/${agentType}`);
      if (!res.ok) return null;
      const data = await res.json();
      return {
        ...data.config,
        configJson: typeof data.config.configJson === "string"
          ? JSON.parse(data.config.configJson)
          : data.config.configJson,
      };
    } catch {
      return null;
    }
  }, []);

  const saveConfig = useCallback(async (
    profileId: string,
    agentType: AgentConfigType,
    configJson: AgentJsonConfig
  ): Promise<AgentProfileConfig | null> => {
    try {
      const res = await fetch(`/api/agent-profiles/${profileId}/configs/${agentType}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configJson }),
      });

      if (!res.ok) return null;
      const data = await res.json();

      // Update active profile if it matches
      if (activeProfile?.id === profileId) {
        setActiveProfileState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            configs: {
              ...prev.configs,
              [agentType]: {
                ...data.config,
                configJson: typeof data.config.configJson === "string"
                  ? JSON.parse(data.config.configJson)
                  : data.config.configJson,
              },
            },
          };
        });
      }

      return data.config;
    } catch {
      return null;
    }
  }, [activeProfile?.id]);

  const exportProfile = useCallback(async (id: string): Promise<string | null> => {
    const profile = await fetchProfile(id);
    if (!profile) return null;

    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      profile: {
        name: profile.name,
        description: profile.description,
        icon: profile.icon,
        color: profile.color,
      },
      configs: Object.fromEntries(
        Object.entries(profile.configs)
          .filter(([, config]) => config !== undefined)
          .map(([type, config]) => [type, config!.configJson])
      ),
    };

    return JSON.stringify(exportData, null, 2);
  }, [fetchProfile]);

  const importProfile = useCallback(async (data: string): Promise<AgentProfile | null> => {
    try {
      const parsed = JSON.parse(data);

      if (!parsed.version || !parsed.profile?.name) {
        throw new Error("Invalid profile format");
      }

      // Create the profile
      const profile = await createProfile(
        parsed.profile.name,
        parsed.profile.description
      );

      if (!profile) return null;

      // Import configs
      const configPromises = Object.entries(parsed.configs || {}).map(
        ([agentType, configJson]) =>
          saveConfig(profile.id, agentType as AgentConfigType, configJson as AgentJsonConfig)
      );

      await Promise.all(configPromises);

      // Update profile with icon/color if present
      if (parsed.profile.icon || parsed.profile.color) {
        await updateProfile(profile.id, {
          icon: parsed.profile.icon,
          color: parsed.profile.color,
        });
      }

      return profile;
    } catch {
      return null;
    }
  }, [createProfile, saveConfig, updateProfile]);

  // Initial fetch
  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  return {
    profiles,
    activeProfile,
    isLoading,
    error,
    fetchProfiles,
    fetchProfile,
    createProfile,
    updateProfile,
    deleteProfile,
    cloneProfile,
    setActiveProfile,
    getConfig,
    saveConfig,
    exportProfile,
    importProfile,
  };
}

/**
 * Helper to get a config or default for an agent type
 */
export function getConfigOrDefault(
  profile: ProfileWithConfigs | null,
  agentType: AgentConfigType
): AgentJsonConfig {
  const config = profile?.configs[agentType];
  return config?.configJson || getDefaultConfig(agentType);
}
