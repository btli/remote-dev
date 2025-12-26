"use client";

import { useState, useEffect, useCallback } from "react";
import { Folder, RotateCcw, Github, FolderGit2, Loader2, Terminal, AlertTriangle, Settings, Palette, Check, Download, FolderOpen, Fingerprint, Play } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import { clearSecretsCache } from "@/hooks/useEnvironmentWithSecrets";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import type { UpdateFolderPreferencesInput, Preferences } from "@/types/preferences";
import type { EnvironmentVariables, ResolvedEnvVar, PortConflict } from "@/types/environment";
import { getSourceLabel } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import { EnvVarEditor } from "./EnvVarEditor";
import { FolderBrowserModal } from "@/components/filesystem/FolderBrowserModal";
import { UnsavedChangesDialog } from "@/components/common/UnsavedChangesDialog";
import { ProfileSelector } from "@/components/profiles/ProfileSelector";
import { useProfileContext } from "@/contexts/ProfileContext";

// Helper to get electron API for directory selection (only in Electron)
function getElectronSelectDirectory(): (() => Promise<string | null>) | null {
  if (typeof window !== "undefined" && "electron" in window) {
    const electron = window.electron as unknown as {
      selectDirectory: () => Promise<string | null>;
    };
    return electron.selectDirectory;
  }
  return null;
}

interface GitHubRepo {
  id: string;
  name: string;
  fullName: string;
  localPath: string | null;
  owner: string;
  updatedAt: string;
}

interface FolderPreferencesModalProps {
  open: boolean;
  onClose: () => void;
  folderId: string;
  folderName: string;
  /** Initial tab to show when opening the modal */
  initialTab?: "general" | "appearance" | "repository" | "environment" | "profile" | "server";
}

const SHELL_OPTIONS = [
  { value: "/bin/bash", label: "Bash" },
  { value: "/bin/zsh", label: "Zsh" },
  { value: "/bin/fish", label: "Fish" },
  { value: "/bin/sh", label: "Sh" },
];

const THEME_OPTIONS = [
  { value: "tokyo-night", label: "Tokyo Night" },
  { value: "dracula", label: "Dracula" },
  { value: "nord", label: "Nord" },
  { value: "monokai", label: "Monokai" },
];

const FONT_OPTIONS = [
  { value: "'JetBrainsMono Nerd Font Mono', monospace", label: "JetBrainsMono" },
  { value: "'FiraCode Nerd Font Mono', monospace", label: "FiraCode" },
  { value: "'Hack Nerd Font Mono', monospace", label: "Hack" },
  { value: "'MesloLGS Nerd Font Mono', monospace", label: "MesloLGS" },
  { value: "'CaskaydiaCove Nerd Font Mono', monospace", label: "CaskaydiaCove (Cascadia)" },
  { value: "'SauceCodePro Nerd Font Mono', monospace", label: "SourceCodePro" },
  { value: "'UbuntuMono Nerd Font Mono', monospace", label: "Ubuntu Mono" },
  { value: "'RobotoMono Nerd Font Mono', monospace", label: "Roboto Mono" },
  { value: "'Inconsolata Nerd Font Mono', monospace", label: "Inconsolata" },
  { value: "'DejaVuSansMono Nerd Font Mono', monospace", label: "DejaVu Sans Mono" },
  { value: "'Mononoki Nerd Font Mono', monospace", label: "Mononoki" },
  { value: "'VictorMono Nerd Font Mono', monospace", label: "Victor Mono" },
  { value: "'SpaceMono Nerd Font Mono', monospace", label: "Space Mono" },
  { value: "'Iosevka Nerd Font Mono', monospace", label: "Iosevka" },
  { value: "'BlexMono Nerd Font Mono', monospace", label: "IBM Plex Mono" },
  { value: "'Cousine Nerd Font Mono', monospace", label: "Cousine" },
  { value: "'ZedMono Nerd Font Mono', monospace", label: "Zed Mono" },
  { value: "'0xProto Nerd Font Mono', monospace", label: "0xProto" },
  // OTF-only fonts loaded from CDN
  { value: "'FiraMono Nerd Font Mono', monospace", label: "Fira Mono" },
  { value: "'GeistMono Nerd Font Mono', monospace", label: "Geist Mono" },
  { value: "'CommitMono Nerd Font Mono', monospace", label: "Commit Mono" },
  { value: "'MonaspaceNeon Nerd Font Mono', monospace", label: "Monaspace Neon" },
];

const INHERIT_VALUE = "__inherit__";

export function FolderPreferencesModal({
  open,
  onClose,
  folderId,
  folderName,
  initialTab = "general",
}: FolderPreferencesModalProps) {
  const {
    getFolderPreferences,
    updateFolderPreferences,
    deleteFolderPreferences,
    folders,
    resolvePreferencesForFolder,
    refreshPreferences,
  } = usePreferencesContext();

  const {
    profiles,
    folderProfileLinks,
    linkFolderToProfile,
    unlinkFolderFromProfile,
  } = useProfileContext();

  // Get parent folder to compute inherited preferences
  const folder = folders.get(folderId);
  const parentFolderId = folder?.parentId ?? null;

  // Resolve preferences WITHOUT this folder's overrides (to show what would be inherited)
  // This walks up to parent folder, grandparent, etc., then user settings, then defaults
  const inheritedPreferences = resolvePreferencesForFolder(parentFolderId);

  const [localSettings, setLocalSettings] = useState<UpdateFolderPreferencesInput>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [repoMode, setRepoMode] = useState<"github" | "local" | "none">("none");
  const [activeTab, setActiveTab] = useState(initialTab);
  const [cloningRepoId, setCloningRepoId] = useState<string | null>(null);
  const [repoOwnerFilter, setRepoOwnerFilter] = useState<string | null>(null);
  const [repoSortBy, setRepoSortBy] = useState<"updated" | "name" | "cloned">("updated");
  const [repoSearchQuery, setRepoSearchQuery] = useState("");
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [folderBrowserTarget, setFolderBrowserTarget] = useState<"working" | "repo" | null>(null);

  // Environment variables state
  const [inheritedEnvVars, setInheritedEnvVars] = useState<ResolvedEnvVar[]>([]);
  const [portConflicts, setPortConflicts] = useState<PortConflict[]>([]);
  const [loadingEnvVars, setLoadingEnvVars] = useState(false);

  // Profile linking state
  const [linkingProfile, setLinkingProfile] = useState(false);
  const linkedProfileId = folderProfileLinks.get(folderId) || null;
  const linkedProfile = linkedProfileId
    ? profiles.find((p) => p.id === linkedProfileId) || null
    : null;

  const folderPrefs = getFolderPreferences(folderId);

  // Check if there are unsaved changes
  const hasChanges = Object.keys(localSettings).length > 0;

  // Handle close with unsaved changes warning
  const handleActualClose = useCallback(() => {
    setLocalSettings({});
    setPortConflicts([]);
    onClose();
  }, [onClose]);

  const {
    showDialog: showUnsavedDialog,
    handleOpenChange,
    handleDiscard,
    handleCancelClose,
  } = useUnsavedChanges({
    hasChanges,
    onClose: handleActualClose,
  });

  // Fetch resolved environment variables for this folder
  const fetchResolvedEnvironment = useCallback(async () => {
    setLoadingEnvVars(true);
    try {
      // Fetch from parent folder (not this folder) to get what would be inherited
      const response = await fetch(
        `/api/preferences/folders/${folderId}/environment`
      );
      if (response.ok) {
        const data = await response.json();
        // Filter to only show inherited vars (from parent chain, not this folder's local overrides)
        const inherited = (data.resolved || []).filter(
          (v: ResolvedEnvVar) =>
            v.source.type !== "folder" || v.source.folderId !== folderId
        );
        setInheritedEnvVars(inherited);
        setPortConflicts(data.portConflicts || []);
      }
    } catch (error) {
      console.error("Failed to fetch resolved environment:", error);
    } finally {
      setLoadingEnvVars(false);
    }
  }, [folderId]);

  // Validate ports when local env vars change
  const validatePortConflicts = useCallback(
    async (envVars: EnvironmentVariables | null) => {
      try {
        const response = await fetch(
          `/api/preferences/folders/${folderId}/validate-ports`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ environmentVars: envVars }),
          }
        );
        if (response.ok) {
          const data = await response.json();
          setPortConflicts(data.conflicts || []);
        }
      } catch (error) {
        console.error("Failed to validate ports:", error);
      }
    },
    [folderId]
  );

  // Fetch GitHub repos when modal opens
  const fetchRepos = useCallback(async () => {
    setLoadingRepos(true);
    setRepoError(null);
    try {
      const response = await fetch("/api/github/repositories?cached=true");
      if (response.ok) {
        const data = await response.json();
        setRepos(data.repositories || []);
      } else {
        setRepoError(`Failed to load repositories (${response.status})`);
      }
    } catch (error) {
      console.error("Failed to fetch repositories:", error);
      setRepoError("Network error loading repositories");
    } finally {
      setLoadingRepos(false);
    }
  }, []);

  // Reset local settings and determine repo mode when modal opens
  useEffect(() => {
    if (open) {
      setLocalSettings({});
      setActiveTab(initialTab);
      setRepoSearchQuery("");
      setRepoOwnerFilter(null);
      fetchRepos();
      fetchResolvedEnvironment();

      // Determine initial repo mode based on existing folder preferences
      if (folderPrefs?.githubRepoId) {
        setRepoMode("github");
      } else if (folderPrefs?.localRepoPath) {
        setRepoMode("local");
      } else {
        setRepoMode("none");
      }
    }
  }, [open, initialTab, folderPrefs?.githubRepoId, folderPrefs?.localRepoPath, fetchRepos, fetchResolvedEnvironment]);

  const handleSave = async () => {
    if (Object.keys(localSettings).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const validation = await updateFolderPreferences(folderId, localSettings);

      // Clear secrets cache for this folder since env vars may have changed
      // This ensures new sessions fetch fresh secrets with updated environment
      clearSecretsCache(folderId);

      // Refresh preferences to ensure all consumers get the latest state
      await refreshPreferences();

      // Update port conflicts from validation result
      if (validation?.hasConflicts) {
        setPortConflicts(validation.conflicts);
        // Don't close - show the warnings
      } else {
        setPortConflicts([]);
        onClose();
      }
    } catch (error) {
      console.error("Failed to save folder preferences:", error);
      setSaveError(error instanceof Error ? error.message : "Failed to save preferences. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await deleteFolderPreferences(folderId);

      // Clear secrets cache and refresh to ensure state is in sync
      clearSecretsCache(folderId);
      await refreshPreferences();

      onClose();
    } catch (error) {
      console.error("Failed to reset folder preferences:", error);
      setSaveError(error instanceof Error ? error.message : "Failed to reset preferences. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const getValue = <K extends keyof UpdateFolderPreferencesInput>(
    key: K
  ): UpdateFolderPreferencesInput[K] | null => {
    if (key in localSettings) {
      return localSettings[key] as UpdateFolderPreferencesInput[K];
    }
    return folderPrefs?.[key as keyof typeof folderPrefs] as UpdateFolderPreferencesInput[K] | null;
  };

  /**
   * Get the inherited value for a preference key.
   * This comes from parent folders, user settings, or defaults.
   */
  const getInherited = <K extends keyof Preferences>(key: K): string => {
    return String(inheritedPreferences[key]);
  };

  /**
   * Get a label describing where the inherited value comes from.
   * E.g., "Inherited from: ParentFolder" or "User settings" or "Default"
   */
  const getInheritedSourceLabel = <K extends keyof Preferences>(key: K): string => {
    const source = inheritedPreferences.source[key];
    return getSourceLabel(source);
  };

  const setValue = <K extends keyof UpdateFolderPreferencesInput>(
    key: K,
    value: UpdateFolderPreferencesInput[K]
  ) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
  };

  const isOverridden = (key: keyof UpdateFolderPreferencesInput): boolean => {
    const value = getValue(key);
    return value !== null && value !== undefined;
  };

  // Get current env vars (local changes or folder prefs or null)
  const getCurrentEnvVars = (): EnvironmentVariables | null => {
    if ("environmentVars" in localSettings) {
      return localSettings.environmentVars ?? null;
    }
    return folderPrefs?.environmentVars ?? null;
  };

  // Handle environment variable changes
  const handleEnvVarsChange = (envVars: EnvironmentVariables | null) => {
    setValue("environmentVars", envVars);
    // Validate ports after change
    validatePortConflicts(envVars);
  };

  // Handle using a suggested port
  const handleUseSuggestedPort = (varName: string, port: number) => {
    const current = getCurrentEnvVars() || {};
    const updated = { ...current, [varName]: String(port) };
    handleEnvVarsChange(updated);
  };

  // Handle profile linking
  const handleProfileChange = useCallback(
    async (profileId: string | null) => {
      setLinkingProfile(true);
      try {
        if (profileId) {
          await linkFolderToProfile(folderId, profileId);
        } else {
          await unlinkFolderFromProfile(folderId);
        }
      } catch (error) {
        console.error("Failed to update profile link:", error);
        setSaveError(
          error instanceof Error ? error.message : "Failed to update profile link"
        );
      } finally {
        setLinkingProfile(false);
      }
    },
    [folderId, linkFolderToProfile, unlinkFolderFromProfile]
  );

  // Handle selecting a repo (clone if needed)
  const handleRepoSelect = async (repo: GitHubRepo) => {
    // If already cloned, just select it
    if (repo.localPath) {
      setValue("githubRepoId", repo.id);
      return;
    }

    // Clone the repo
    setCloningRepoId(repo.id);
    setRepoError(null);

    try {
      // Determine target path: use folder's defaultWorkingDirectory if set
      const workingDir = getValue("defaultWorkingDirectory") || folderPrefs?.defaultWorkingDirectory;
      const [, repoName] = repo.fullName.split("/");
      const targetPath = workingDir ? `${workingDir}/${repoName}` : undefined;

      const response = await fetch(`/api/github/repositories/${repo.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPath }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Clone failed");
      }

      const data = await response.json();

      // Update the repo in our local state
      setRepos((prev) =>
        prev.map((r) =>
          r.id === repo.id ? { ...r, localPath: data.localPath } : r
        )
      );

      // Select the newly cloned repo
      setValue("githubRepoId", repo.id);
    } catch (error) {
      console.error("Failed to clone repository:", error);
      setRepoError(error instanceof Error ? error.message : "Clone failed");
    } finally {
      setCloningRepoId(null);
    }
  };

  // Check if any settings in a tab are overridden
  const hasGeneralOverrides = isOverridden("defaultWorkingDirectory") || isOverridden("defaultShell") || isOverridden("startupCommand");
  const hasAppearanceOverrides = isOverridden("theme") || isOverridden("fontSize") || isOverridden("fontFamily");
  const hasRepoOverrides = isOverridden("githubRepoId") || isOverridden("localRepoPath");
  const hasEnvOverrides = isOverridden("environmentVars");
  const hasProfileLink = !!linkedProfileId;
  const hasServerOverrides = isOverridden("serverStartupCommand") || isOverridden("buildCommand") || isOverridden("runBuildBeforeStart");

  // Get unique owners from repos for filtering
  const repoOwners = Array.from(new Set(repos.map((r) => r.owner))).sort();

  // Filter and sort repos (selected repo always first)
  const selectedRepoId = getValue("githubRepoId");
  const searchLower = repoSearchQuery.toLowerCase();
  const filteredAndSortedRepos = repos
    .filter((repo) => {
      // Owner filter
      if (repoOwnerFilter && repo.owner !== repoOwnerFilter) return false;
      // Text search filter
      if (searchLower && !repo.name.toLowerCase().includes(searchLower)) return false;
      return true;
    })
    .sort((a, b) => {
      // Selected repo always first
      if (a.id === selectedRepoId) return -1;
      if (b.id === selectedRepoId) return 1;

      switch (repoSortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "cloned":
          // Cloned first, then by name
          if (a.localPath && !b.localPath) return -1;
          if (!a.localPath && b.localPath) return 1;
          return a.name.localeCompare(b.name);
        case "updated":
        default:
          // Most recently updated first
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
    });

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[85vh] bg-slate-900/95 backdrop-blur-xl border-white/10 flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-white">
            <Folder className="w-5 h-5 text-violet-400 fill-violet-400/30" />
            {folderName} Preferences
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Override settings for sessions in this folder.
            Leave empty to inherit from{" "}
            {parentFolderId ? "parent folder" : "user settings"}.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="flex-1 min-h-0 flex flex-col">
          <TabsList className="w-full bg-slate-800/50 flex-shrink-0">
            <TabsTrigger value="general" className="flex-1 gap-1.5 text-xs data-[state=active]:bg-slate-700">
              <Settings className="w-3.5 h-3.5" />
              General
              {hasGeneralOverrides && <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />}
            </TabsTrigger>
            <TabsTrigger value="appearance" className="flex-1 gap-1.5 text-xs data-[state=active]:bg-slate-700">
              <Palette className="w-3.5 h-3.5" />
              Appearance
              {hasAppearanceOverrides && <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />}
            </TabsTrigger>
            <TabsTrigger value="repository" className="flex-1 gap-1.5 text-xs data-[state=active]:bg-slate-700">
              <FolderGit2 className="w-3.5 h-3.5" />
              Repo
              {hasRepoOverrides && <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />}
            </TabsTrigger>
            <TabsTrigger value="environment" className="flex-1 gap-1.5 text-xs data-[state=active]:bg-slate-700">
              <Terminal className="w-3.5 h-3.5" />
              Env
              {hasEnvOverrides && <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />}
            </TabsTrigger>
            <TabsTrigger value="profile" className="flex-1 gap-1.5 text-xs data-[state=active]:bg-slate-700">
              <Fingerprint className="w-3.5 h-3.5" />
              Profile
              {hasProfileLink && <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />}
            </TabsTrigger>
            <TabsTrigger value="server" className="flex-1 gap-1.5 text-xs data-[state=active]:bg-slate-700">
              <Play className="w-3.5 h-3.5" />
              Server
              {hasServerOverrides && <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />}
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto min-h-0 py-4">
            {/* General Tab */}
            <TabsContent value="general" className="mt-0 space-y-4">
              {/* Working Directory */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-slate-300">Working Directory</Label>
                  {isOverridden("defaultWorkingDirectory") && (
                    <span className="text-xs text-violet-400">Overridden</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={getValue("defaultWorkingDirectory") || ""}
                    onChange={(e) =>
                      setValue("defaultWorkingDirectory", e.target.value || null)
                    }
                    placeholder={`${getInheritedSourceLabel("defaultWorkingDirectory")}: ${getInherited("defaultWorkingDirectory")}`}
                    className={cn(
                      "flex-1 bg-slate-800 border-white/10 text-white placeholder:text-slate-500",
                      isOverridden("defaultWorkingDirectory") && "border-violet-500/50"
                    )}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={async () => {
                      const selectDirectory = getElectronSelectDirectory();
                      if (selectDirectory) {
                        // Use native Electron picker if available
                        const path = await selectDirectory();
                        if (path) {
                          setValue("defaultWorkingDirectory", path);
                        }
                      } else {
                        // Use web-based folder browser
                        setFolderBrowserTarget("working");
                        setShowFolderBrowser(true);
                      }
                    }}
                    className="shrink-0 bg-slate-800 border-white/10 hover:bg-slate-700"
                  >
                    <FolderOpen className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Shell */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-slate-300">Shell</Label>
                  {isOverridden("defaultShell") && (
                    <span className="text-xs text-violet-400">Overridden</span>
                  )}
                </div>
                <Select
                  value={getValue("defaultShell") || INHERIT_VALUE}
                  onValueChange={(value) => setValue("defaultShell", value === INHERIT_VALUE ? null : value)}
                >
                  <SelectTrigger
                    className={cn(
                      "bg-slate-800 border-white/10 text-white",
                      isOverridden("defaultShell") && "border-violet-500/50"
                    )}
                  >
                    <SelectValue
                      placeholder={`Inherit: ${
                        SHELL_OPTIONS.find((o) => o.value === getInherited("defaultShell"))
                          ?.label || getInherited("defaultShell")
                      }`}
                    />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-white/10">
                    <SelectItem value={INHERIT_VALUE} className="text-slate-400 focus:bg-violet-500/20">
                      {getInheritedSourceLabel("defaultShell")}
                    </SelectItem>
                    {SHELL_OPTIONS.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                        className="text-white focus:bg-violet-500/20"
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Startup Command */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-slate-300">Startup Command</Label>
                  {isOverridden("startupCommand") && (
                    <span className="text-xs text-violet-400">Overridden</span>
                  )}
                </div>
                <Input
                  value={getValue("startupCommand") || ""}
                  onChange={(e) =>
                    setValue("startupCommand", e.target.value || null)
                  }
                  placeholder={getInherited("startupCommand") ? `${getInheritedSourceLabel("startupCommand")}: ${getInherited("startupCommand")}` : "No startup command"}
                  className={cn(
                    "bg-slate-800 border-white/10 text-white placeholder:text-slate-500",
                    isOverridden("startupCommand") && "border-violet-500/50"
                  )}
                />
                <p className="text-xs text-slate-500">
                  Command to run when a new session starts in this folder.
                </p>
              </div>
            </TabsContent>

            {/* Appearance Tab */}
            <TabsContent value="appearance" className="mt-0 space-y-4">
              {/* Theme */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-slate-300">Theme</Label>
                  {isOverridden("theme") && (
                    <span className="text-xs text-violet-400">Overridden</span>
                  )}
                </div>
                <Select
                  value={getValue("theme") || INHERIT_VALUE}
                  onValueChange={(value) => setValue("theme", value === INHERIT_VALUE ? null : value)}
                >
                  <SelectTrigger
                    className={cn(
                      "bg-slate-800 border-white/10 text-white",
                      isOverridden("theme") && "border-violet-500/50"
                    )}
                  >
                    <SelectValue
                      placeholder={`Inherit: ${
                        THEME_OPTIONS.find((o) => o.value === getInherited("theme"))
                          ?.label || getInherited("theme")
                      }`}
                    />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-white/10">
                    <SelectItem value={INHERIT_VALUE} className="text-slate-400 focus:bg-violet-500/20">
                      {getInheritedSourceLabel("theme")}
                    </SelectItem>
                    {THEME_OPTIONS.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                        className="text-white focus:bg-violet-500/20"
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Font Size */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-slate-300">Font Size</Label>
                  <span className="text-sm text-slate-400">
                    {getValue("fontSize") || `Inherit: ${getInherited("fontSize")}`}px
                  </span>
                </div>
                <Slider
                  value={[getValue("fontSize") || Number(getInherited("fontSize"))]}
                  onValueChange={([value]) => setValue("fontSize", value)}
                  min={10}
                  max={24}
                  step={1}
                  className="w-full"
                />
              </div>

              {/* Font Family */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-slate-300">Font Family</Label>
                  {isOverridden("fontFamily") && (
                    <span className="text-xs text-violet-400">Overridden</span>
                  )}
                </div>
                <Select
                  value={getValue("fontFamily") || INHERIT_VALUE}
                  onValueChange={(value) => setValue("fontFamily", value === INHERIT_VALUE ? null : value)}
                >
                  <SelectTrigger
                    className={cn(
                      "bg-slate-800 border-white/10 text-white",
                      isOverridden("fontFamily") && "border-violet-500/50"
                    )}
                  >
                    <SelectValue
                      placeholder={`Inherit: ${
                        FONT_OPTIONS.find((o) => o.value === getInherited("fontFamily"))
                          ?.label || "JetBrains Mono"
                      }`}
                    />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-white/10 max-h-60">
                    <SelectItem value={INHERIT_VALUE} className="text-slate-400 focus:bg-violet-500/20">
                      {getInheritedSourceLabel("fontFamily")}
                    </SelectItem>
                    {FONT_OPTIONS.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                        className="text-white focus:bg-violet-500/20"
                        style={{ fontFamily: option.value }}
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>

            {/* Repository Tab */}
            <TabsContent value="repository" className="mt-0 space-y-4">
              <div className="space-y-2">
                <p className="text-sm text-slate-400">
                  Link a repository to enable worktree creation from this folder.
                </p>

                {/* Repo mode selector */}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setRepoMode("none");
                      setValue("githubRepoId", null);
                      setValue("localRepoPath", null);
                    }}
                    className={cn(
                      "flex-1 text-xs",
                      repoMode === "none"
                        ? "bg-slate-700 text-white"
                        : "text-slate-400 hover:text-white"
                    )}
                  >
                    None
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setRepoMode("github");
                      setValue("localRepoPath", null);
                    }}
                    className={cn(
                      "flex-1 text-xs",
                      repoMode === "github"
                        ? "bg-slate-700 text-white"
                        : "text-slate-400 hover:text-white"
                    )}
                  >
                    <Github className="w-3 h-3 mr-1" />
                    GitHub
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setRepoMode("local");
                      setValue("githubRepoId", null);
                    }}
                    className={cn(
                      "flex-1 text-xs",
                      repoMode === "local"
                        ? "bg-slate-700 text-white"
                        : "text-slate-400 hover:text-white"
                    )}
                  >
                    <FolderGit2 className="w-3 h-3 mr-1" />
                    Local Path
                  </Button>
                </div>

                {/* GitHub repo selector */}
                {repoMode === "github" && (
                  <div className="space-y-2 pt-2">
                    {loadingRepos ? (
                      <div className="flex items-center justify-center py-4 text-slate-400">
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        Loading repositories...
                      </div>
                    ) : repoError ? (
                      <div className="space-y-2">
                        <p className="text-sm text-red-400 py-2">
                          {repoError}
                        </p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setRepoError(null)}
                          className="text-xs text-slate-400"
                        >
                          Dismiss
                        </Button>
                      </div>
                    ) : repos.length === 0 ? (
                      <p className="text-sm text-slate-500 py-2">
                        No repositories found. Connect GitHub to see your repos.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {/* Search input */}
                        <Input
                          value={repoSearchQuery}
                          onChange={(e) => setRepoSearchQuery(e.target.value)}
                          placeholder="Search repositories..."
                          className="h-7 text-xs bg-slate-800 border-white/10 text-white placeholder:text-slate-500"
                        />
                        {/* Filter and sort controls */}
                        <div className="flex items-center gap-2">
                          {/* Owner filter tabs */}
                          <div className="flex-1 flex gap-1 overflow-x-auto">
                            <button
                              type="button"
                              onClick={() => setRepoOwnerFilter(null)}
                              className={cn(
                                "px-2 py-1 text-xs rounded-md whitespace-nowrap transition-colors",
                                !repoOwnerFilter
                                  ? "bg-violet-500/20 text-violet-300"
                                  : "text-slate-400 hover:text-white hover:bg-white/5"
                              )}
                            >
                              All ({repos.length})
                            </button>
                            {repoOwners.map((owner) => {
                              const count = repos.filter((r) => r.owner === owner).length;
                              return (
                                <button
                                  key={owner}
                                  type="button"
                                  onClick={() => setRepoOwnerFilter(owner)}
                                  className={cn(
                                    "px-2 py-1 text-xs rounded-md whitespace-nowrap transition-colors",
                                    repoOwnerFilter === owner
                                      ? "bg-violet-500/20 text-violet-300"
                                      : "text-slate-400 hover:text-white hover:bg-white/5"
                                  )}
                                >
                                  {owner} ({count})
                                </button>
                              );
                            })}
                          </div>
                          {/* Sort dropdown */}
                          <Select
                            value={repoSortBy}
                            onValueChange={(v) => setRepoSortBy(v as typeof repoSortBy)}
                          >
                            <SelectTrigger className="w-[100px] h-7 text-xs bg-slate-800 border-white/10">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-800 border-white/10">
                              <SelectItem value="updated" className="text-xs">Recent</SelectItem>
                              <SelectItem value="name" className="text-xs">Name</SelectItem>
                              <SelectItem value="cloned" className="text-xs">Cloned</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Repo list */}
                        <div className="max-h-[180px] overflow-y-auto rounded-md border border-white/10 bg-slate-800/50">
                          {filteredAndSortedRepos.length === 0 ? (
                            <div className="px-3 py-4 text-center text-sm text-slate-500">
                              No repos match filter
                            </div>
                          ) : (
                            filteredAndSortedRepos.map((repo) => {
                              const isSelected = getValue("githubRepoId") === repo.id;
                              const isCloning = cloningRepoId === repo.id;
                              const isCloned = !!repo.localPath;

                              return (
                                <button
                                  key={repo.id}
                                  type="button"
                                  onClick={() => handleRepoSelect(repo)}
                                  disabled={isCloning || cloningRepoId !== null}
                                  className={cn(
                                    "w-full flex items-start gap-2 px-2.5 py-1.5 text-left transition-colors",
                                    "hover:bg-white/5 focus:bg-white/5 focus:outline-none",
                                    "border-b border-white/5 last:border-b-0",
                                    isSelected && "bg-violet-500/20",
                                    (isCloning || (cloningRepoId !== null && !isCloning)) && "opacity-50 cursor-not-allowed"
                                  )}
                                >
                                  {/* Status icon */}
                                  <div className="mt-0.5 shrink-0">
                                    {isCloning ? (
                                      <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin" />
                                    ) : isSelected ? (
                                      <Check className="w-3.5 h-3.5 text-violet-400" />
                                    ) : isCloned ? (
                                      <FolderGit2 className="w-3.5 h-3.5 text-emerald-400" />
                                    ) : (
                                      <Download className="w-3.5 h-3.5 text-amber-400" />
                                    )}
                                  </div>
                                  {/* Repo info */}
                                  <div className="flex-1 min-w-0">
                                    <span className={cn(
                                      "block text-xs font-medium truncate",
                                      isSelected ? "text-white" : isCloned ? "text-slate-200" : "text-slate-300"
                                    )}>
                                      {repo.name}
                                    </span>
                                    {isCloning ? (
                                      <span className="text-[10px] text-violet-400">Cloning...</span>
                                    ) : isCloned ? (
                                      <span className="text-[10px] text-slate-500 truncate block">
                                        {repo.localPath}
                                      </span>
                                    ) : (
                                      <span className="text-[10px] text-amber-400">Click to clone</span>
                                    )}
                                  </div>
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Local path input */}
                {repoMode === "local" && (
                  <div className="pt-2 flex gap-2">
                    <Input
                      value={getValue("localRepoPath") || ""}
                      onChange={(e) => setValue("localRepoPath", e.target.value || null)}
                      placeholder="/path/to/local/git/repository"
                      className={cn(
                        "flex-1 bg-slate-800 border-white/10 text-white placeholder:text-slate-500",
                        isOverridden("localRepoPath") && "border-violet-500/50"
                      )}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={async () => {
                        const selectDirectory = getElectronSelectDirectory();
                        if (selectDirectory) {
                          // Use native Electron picker if available
                          const path = await selectDirectory();
                          if (path) {
                            setValue("localRepoPath", path);
                          }
                        } else {
                          // Use web-based folder browser
                          setFolderBrowserTarget("repo");
                          setShowFolderBrowser(true);
                        }
                      }}
                      className="shrink-0 bg-slate-800 border-white/10 hover:bg-slate-700"
                    >
                      <FolderOpen className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Environment Tab */}
            <TabsContent value="environment" className="mt-0 space-y-4">
              <p className="text-sm text-slate-400">
                Set environment variables for terminal sessions in this folder.
                Variables are inherited from parent folders and can be overridden.
              </p>
              {loadingEnvVars ? (
                <div className="flex items-center justify-center py-4 text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Loading environment...
                </div>
              ) : (
                <EnvVarEditor
                  localEnvVars={getCurrentEnvVars()}
                  inheritedEnvVars={inheritedEnvVars}
                  portConflicts={portConflicts}
                  onChange={handleEnvVarsChange}
                  onUseSuggestedPort={handleUseSuggestedPort}
                />
              )}
            </TabsContent>

            {/* Profile Tab */}
            <TabsContent value="profile" className="mt-0 space-y-4">
              <p className="text-sm text-slate-400">
                Link an agent profile to apply git identity, secrets, and MCP servers
                to all sessions created in this folder.
              </p>

              <div className="space-y-3">
                <Label className="text-slate-300">Agent Profile</Label>
                <ProfileSelector
                  value={linkedProfileId}
                  onChange={handleProfileChange}
                  placeholder="Select a profile to link..."
                  disabled={linkingProfile}
                  showProviderBadge={true}
                />
                {linkingProfile && (
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Updating...
                  </div>
                )}
              </div>

              {/* Profile Summary */}
              {linkedProfile && (
                <div className="p-4 rounded-lg bg-slate-800/50 border border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Fingerprint className="w-4 h-4 text-violet-400" />
                      <span className="font-medium text-white">{linkedProfile.name}</span>
                    </div>
                    <span className="text-xs text-slate-500 capitalize">
                      {linkedProfile.provider}
                    </span>
                  </div>
                  {linkedProfile.description && (
                    <p className="text-sm text-slate-400">{linkedProfile.description}</p>
                  )}
                  <p className="text-xs text-slate-500">
                    Sessions in this folder will use this profile&apos;s git identity,
                    secrets, and MCP servers.
                  </p>
                </div>
              )}

              {/* Empty state */}
              {!linkedProfile && profiles.length === 0 && (
                <div className="p-4 rounded-lg bg-slate-800/30 border border-white/5 text-center">
                  <Fingerprint className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                  <p className="text-sm text-slate-400">No profiles created yet</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Create profiles to manage git identity, secrets, and MCP servers.
                  </p>
                </div>
              )}
            </TabsContent>

            {/* Server Tab */}
            <TabsContent value="server" className="mt-0 space-y-4">
              <p className="text-sm text-slate-400">
                Configure a development server for this folder. Start/stop the server
                from the folder context menu, and preview it in a browser tab.
              </p>

              {/* Server Startup Command */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-slate-300">Server Startup Command</Label>
                  {isOverridden("serverStartupCommand") && (
                    <span className="text-xs text-violet-400">Set</span>
                  )}
                </div>
                <Input
                  value={getValue("serverStartupCommand") || ""}
                  onChange={(e) =>
                    setValue("serverStartupCommand", e.target.value || null)
                  }
                  placeholder="e.g., bun run dev"
                  className={cn(
                    "bg-slate-800 border-white/10 text-white placeholder:text-slate-500",
                    isOverridden("serverStartupCommand") && "border-violet-500/50"
                  )}
                />
                <p className="text-xs text-slate-500">
                  The command to start your development server.
                </p>
              </div>

              {/* Build Command */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-slate-300">Build Command</Label>
                  {isOverridden("buildCommand") && (
                    <span className="text-xs text-violet-400">Set</span>
                  )}
                </div>
                <Input
                  value={getValue("buildCommand") || ""}
                  onChange={(e) =>
                    setValue("buildCommand", e.target.value || null)
                  }
                  placeholder="e.g., bun run build"
                  className={cn(
                    "bg-slate-800 border-white/10 text-white placeholder:text-slate-500",
                    isOverridden("buildCommand") && "border-violet-500/50"
                  )}
                />
                <p className="text-xs text-slate-500">
                  Optional command to build before starting the server.
                </p>
              </div>

              {/* Run Build Before Start Toggle */}
              <div className="flex items-center justify-between p-4 rounded-lg bg-slate-800/50 border border-white/10">
                <div className="space-y-1">
                  <Label className="text-slate-300">Run Build Before Start</Label>
                  <p className="text-xs text-slate-500">
                    Automatically run the build command before starting the server.
                  </p>
                </div>
                <Switch
                  checked={getValue("runBuildBeforeStart") ?? false}
                  onCheckedChange={(checked) =>
                    setValue("runBuildBeforeStart", checked)
                  }
                  disabled={!getValue("buildCommand") && !folderPrefs?.buildCommand}
                />
              </div>

              {/* Help text */}
              <div className="p-3 rounded-lg bg-slate-800/30 border border-white/5">
                <p className="text-xs text-slate-500">
                  <strong className="text-slate-400">Tip:</strong> Set the PORT environment variable
                  in the Environment tab to specify which port your server runs on.
                  This is required for the browser preview to work.
                </p>
              </div>
            </TabsContent>
          </div>
        </Tabs>

        <div className="flex flex-col gap-2 pt-4 border-t border-white/5 flex-shrink-0">
          {saveError && (
            <p className="text-sm text-red-400">{saveError}</p>
          )}
          {portConflicts.length > 0 && (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <div className="flex items-center gap-2 text-amber-400 mb-2">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-sm font-medium">Port Conflicts Detected</span>
              </div>
              <ul className="text-sm text-amber-300/80 space-y-1">
                {portConflicts.map((conflict, idx) => (
                  <li key={idx}>
                    Port {conflict.port} ({conflict.variableName}) conflicts with folder &quot;{conflict.conflictingFolder.name}&quot;
                    {conflict.suggestedPort && (
                      <span className="text-slate-400 ml-1">
                        (suggested: {conflict.suggestedPort})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-slate-400 mt-2">
                Changes saved. You may want to update the conflicting ports.
              </p>
            </div>
          )}
          <div className="flex justify-between">
            {folderPrefs && (
              <Button
                variant="ghost"
                onClick={handleReset}
                disabled={saving}
                className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Reset All
              </Button>
            )}
            <div className="flex gap-2 ml-auto">
            <Button
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              className="text-slate-400 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {saving ? "Saving..." : "Save Changes"}
            </Button>
            </div>
          </div>
        </div>
      </DialogContent>

      {/* Folder Browser Modal */}
      <FolderBrowserModal
        open={showFolderBrowser}
        onClose={() => setShowFolderBrowser(false)}
        onSelect={(path) => {
          if (folderBrowserTarget === "working") {
            setValue("defaultWorkingDirectory", path);
          } else if (folderBrowserTarget === "repo") {
            setValue("localRepoPath", path);
          }
          setShowFolderBrowser(false);
        }}
        initialPath={
          folderBrowserTarget === "working"
            ? getValue("defaultWorkingDirectory") || undefined
            : folderBrowserTarget === "repo"
              ? getValue("localRepoPath") || undefined
              : undefined
        }
        title={
          folderBrowserTarget === "working"
            ? "Select Working Directory"
            : "Select Repository Path"
        }
      />
    </Dialog>

    <UnsavedChangesDialog
      open={showUnsavedDialog}
      onDiscard={handleDiscard}
      onCancel={handleCancelClose}
    />
    </>
  );
}
