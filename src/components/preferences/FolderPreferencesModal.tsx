"use client";

import { useState, useEffect, useCallback } from "react";
import { Folder, RotateCcw, Github, FolderGit2, Loader2, Terminal, AlertTriangle, Settings, Palette, Check, Download } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import { clearSecretsCache } from "@/hooks/useEnvironmentWithSecrets";
import type { UpdateFolderPreferencesInput, Preferences } from "@/types/preferences";
import type { EnvironmentVariables, ResolvedEnvVar, PortConflict } from "@/types/environment";
import { getSourceLabel } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import { EnvVarEditor } from "./EnvVarEditor";

interface GitHubRepo {
  id: string;
  name: string;
  fullName: string;
  localPath: string | null;
}

interface FolderPreferencesModalProps {
  open: boolean;
  onClose: () => void;
  folderId: string;
  folderName: string;
  /** Initial tab to show when opening the modal */
  initialTab?: "general" | "appearance" | "repository" | "environment";
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

  // Environment variables state
  const [inheritedEnvVars, setInheritedEnvVars] = useState<ResolvedEnvVar[]>([]);
  const [portConflicts, setPortConflicts] = useState<PortConflict[]>([]);
  const [loadingEnvVars, setLoadingEnvVars] = useState(false);

  const folderPrefs = getFolderPreferences(folderId);

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

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px] max-h-[85vh] bg-slate-900 border-white/10 flex flex-col">
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
                <Input
                  value={getValue("defaultWorkingDirectory") || ""}
                  onChange={(e) =>
                    setValue("defaultWorkingDirectory", e.target.value || null)
                  }
                  placeholder={`${getInheritedSourceLabel("defaultWorkingDirectory")}: ${getInherited("defaultWorkingDirectory")}`}
                  className={cn(
                    "bg-slate-800 border-white/10 text-white placeholder:text-slate-500",
                    isOverridden("defaultWorkingDirectory") && "border-violet-500/50"
                  )}
                />
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
                      <div className="max-h-[200px] overflow-y-auto rounded-md border border-white/10 bg-slate-800/50">
                        {repos.map((repo) => {
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
                                "w-full flex items-start gap-2 px-3 py-2 text-left transition-colors",
                                "hover:bg-white/5 focus:bg-white/5 focus:outline-none",
                                "border-b border-white/5 last:border-b-0",
                                isSelected && "bg-violet-500/20",
                                (isCloning || (cloningRepoId !== null && !isCloning)) && "opacity-50 cursor-not-allowed"
                              )}
                            >
                              {/* Status icon */}
                              <div className="mt-0.5 shrink-0">
                                {isCloning ? (
                                  <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />
                                ) : isSelected ? (
                                  <Check className="w-4 h-4 text-violet-400" />
                                ) : isCloned ? (
                                  <FolderGit2 className="w-4 h-4 text-emerald-400" />
                                ) : (
                                  <Download className="w-4 h-4 text-amber-400" />
                                )}
                              </div>
                              {/* Repo info */}
                              <div className="flex-1 min-w-0">
                                <span className={cn(
                                  "block text-sm font-medium truncate",
                                  isSelected ? "text-white" : isCloned ? "text-slate-200" : "text-slate-300"
                                )}>
                                  {repo.fullName}
                                </span>
                                {isCloning ? (
                                  <span className="text-xs text-violet-400">Cloning...</span>
                                ) : isCloned ? (
                                  <span className="text-xs text-slate-500 truncate block">
                                    {repo.localPath}
                                  </span>
                                ) : (
                                  <span className="text-xs text-amber-400">Click to clone</span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Local path input */}
                {repoMode === "local" && (
                  <div className="pt-2">
                    <Input
                      value={getValue("localRepoPath") || ""}
                      onChange={(e) => setValue("localRepoPath", e.target.value || null)}
                      placeholder="/path/to/local/git/repository"
                      className={cn(
                        "bg-slate-800 border-white/10 text-white placeholder:text-slate-500",
                        isOverridden("localRepoPath") && "border-violet-500/50"
                      )}
                    />
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
              onClick={onClose}
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
    </Dialog>
  );
}
