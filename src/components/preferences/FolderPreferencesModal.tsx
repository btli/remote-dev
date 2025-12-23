"use client";

import { useState, useEffect, useCallback } from "react";
import { Folder, RotateCcw, Github, FolderGit2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import type { UpdateFolderPreferencesInput, Preferences } from "@/types/preferences";
import { getSourceLabel } from "@/lib/preferences";
import { cn } from "@/lib/utils";

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
}: FolderPreferencesModalProps) {
  const {
    getFolderPreferences,
    updateFolderPreferences,
    deleteFolderPreferences,
    folders,
    resolvePreferencesForFolder,
  } = usePreferencesContext();

  // Get parent folder to compute inherited preferences
  const folder = folders.get(folderId);
  const parentFolderId = folder?.parentId ?? null;

  // Resolve preferences WITHOUT this folder's overrides (to show what would be inherited)
  // This walks up to parent folder, grandparent, etc., then user settings, then defaults
  const inheritedPreferences = resolvePreferencesForFolder(parentFolderId);

  const [localSettings, setLocalSettings] = useState<UpdateFolderPreferencesInput>({});
  const [saving, setSaving] = useState(false);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [repoMode, setRepoMode] = useState<"github" | "local" | "none">("none");

  const folderPrefs = getFolderPreferences(folderId);

  // Fetch GitHub repos when modal opens
  const fetchRepos = useCallback(async () => {
    setLoadingRepos(true);
    try {
      const response = await fetch("/api/github/repositories?cached=true");
      if (response.ok) {
        const data = await response.json();
        setRepos(data.repositories || []);
      }
    } catch (error) {
      console.error("Failed to fetch repositories:", error);
    } finally {
      setLoadingRepos(false);
    }
  }, []);

  // Reset local settings and determine repo mode when modal opens
  useEffect(() => {
    if (open) {
      setLocalSettings({});
      fetchRepos();

      // Determine initial repo mode based on existing folder preferences
      if (folderPrefs?.githubRepoId) {
        setRepoMode("github");
      } else if (folderPrefs?.localRepoPath) {
        setRepoMode("local");
      } else {
        setRepoMode("none");
      }
    }
  }, [open, folderPrefs?.githubRepoId, folderPrefs?.localRepoPath, fetchRepos]);

  const handleSave = async () => {
    if (Object.keys(localSettings).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      await updateFolderPreferences(folderId, localSettings);
      onClose();
    } catch (error) {
      console.error("Failed to save folder preferences:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      await deleteFolderPreferences(folderId);
      onClose();
    } catch (error) {
      console.error("Failed to reset folder preferences:", error);
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

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px] bg-slate-900 border-white/10">
        <DialogHeader>
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

        <div className="space-y-4 mt-4">
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
          </div>

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
              <SelectContent className="bg-slate-800 border-white/10">
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

          {/* Repository Association - for worktree support */}
          <div className="space-y-3 pt-4 border-t border-white/5">
            <div className="flex items-center justify-between">
              <Label className="text-slate-300 flex items-center gap-2">
                <FolderGit2 className="w-4 h-4" />
                Repository
              </Label>
              {(isOverridden("githubRepoId") || isOverridden("localRepoPath")) && (
                <span className="text-xs text-violet-400">Configured</span>
              )}
            </div>
            <p className="text-xs text-slate-500">
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
              <div className="space-y-2">
                {loadingRepos ? (
                  <div className="flex items-center justify-center py-4 text-slate-400">
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Loading repositories...
                  </div>
                ) : repos.length === 0 ? (
                  <p className="text-sm text-slate-500 py-2">
                    No cloned repositories found. Clone a repository first.
                  </p>
                ) : (
                  <Select
                    value={getValue("githubRepoId") || ""}
                    onValueChange={(value) => setValue("githubRepoId", value || null)}
                  >
                    <SelectTrigger
                      className={cn(
                        "bg-slate-800 border-white/10 text-white",
                        isOverridden("githubRepoId") && "border-violet-500/50"
                      )}
                    >
                      <SelectValue placeholder="Select a repository..." />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-white/10 max-h-60">
                      {repos.map((repo) => (
                        <SelectItem
                          key={repo.id}
                          value={repo.id}
                          className="text-white focus:bg-violet-500/20"
                          disabled={!repo.localPath}
                        >
                          <div className="flex flex-col">
                            <span>{repo.fullName}</span>
                            {repo.localPath && (
                              <span className="text-xs text-slate-500 truncate max-w-[300px]">
                                {repo.localPath}
                              </span>
                            )}
                            {!repo.localPath && (
                              <span className="text-xs text-amber-500">Not cloned</span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* Local path input */}
            {repoMode === "local" && (
              <Input
                value={getValue("localRepoPath") || ""}
                onChange={(e) => setValue("localRepoPath", e.target.value || null)}
                placeholder="/path/to/local/git/repository"
                className={cn(
                  "bg-slate-800 border-white/10 text-white placeholder:text-slate-500",
                  isOverridden("localRepoPath") && "border-violet-500/50"
                )}
              />
            )}
          </div>
        </div>

        <div className="flex justify-between pt-4 border-t border-white/5">
          {folderPrefs && (
            <Button
              variant="ghost"
              onClick={handleReset}
              disabled={saving}
              className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Reset to Defaults
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
      </DialogContent>
    </Dialog>
  );
}
