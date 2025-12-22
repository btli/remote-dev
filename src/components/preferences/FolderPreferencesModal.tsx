"use client";

import { useState, useEffect } from "react";
import { Folder, RotateCcw, Github, Loader2, X, Check, Download } from "lucide-react";
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
import { FolderRepositoryPicker } from "@/components/github/FolderRepositoryPicker";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import type { UpdateFolderPreferencesInput } from "@/types/preferences";
import type { CachedGitHubRepository } from "@/types/github";
import { cn } from "@/lib/utils";

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
  { value: "'JetBrains Mono', monospace", label: "JetBrains Mono" },
  { value: "'Fira Code', monospace", label: "Fira Code" },
  { value: "'Source Code Pro', monospace", label: "Source Code Pro" },
  { value: "'Monaco', monospace", label: "Monaco" },
  { value: "'Menlo', monospace", label: "Menlo" },
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
    userSettings,
    currentPreferences,
  } = usePreferencesContext();

  const [localSettings, setLocalSettings] = useState<UpdateFolderPreferencesInput>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isRepoPickerOpen, setIsRepoPickerOpen] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<CachedGitHubRepository | null>(null);
  const [cloningStatus, setCloningStatus] = useState<string | null>(null);

  const folderPrefs = getFolderPreferences(folderId);

  // Reset local settings when modal opens
  useEffect(() => {
    if (open) {
      setLocalSettings({});
      setSelectedRepo(null);
      setSaveError(null);
      setCloningStatus(null);
    }
  }, [open]);

  // Fetch the currently linked repository details when modal opens
  useEffect(() => {
    async function fetchLinkedRepo() {
      const repoId = folderPrefs?.githubRepoId;
      if (!repoId || !open) return;

      try {
        const response = await fetch(`/api/github/repositories?includeCloneStatus=true`);
        if (response.ok) {
          const data = await response.json();
          const repo = data.repositories.find((r: CachedGitHubRepository) => r.id === repoId);
          if (repo) {
            setSelectedRepo(repo);
          }
        }
      } catch (err) {
        console.error("Failed to fetch linked repository:", err);
      }
    }
    fetchLinkedRepo();
  }, [open, folderPrefs?.githubRepoId]);

  const handleSave = async () => {
    const hasChanges = Object.keys(localSettings).length > 0;
    const hasRepoChange = "githubRepoId" in localSettings;

    if (!hasChanges) {
      onClose();
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      // If a repo is selected and it's not cloned, clone it first
      if (hasRepoChange && selectedRepo && !selectedRepo.localPath) {
        setCloningStatus("Cloning repository...");
        const cloneResponse = await fetch(`/api/github/repositories/${selectedRepo.githubId}`, {
          method: "POST",
        });

        if (!cloneResponse.ok) {
          const data = await cloneResponse.json();
          throw new Error(data.error || "Failed to clone repository");
        }

        const cloneData = await cloneResponse.json();

        // Auto-set working directory to the cloned path
        localSettings.defaultWorkingDirectory = cloneData.localPath;
      }

      setCloningStatus(null);
      await updateFolderPreferences(folderId, localSettings);
      onClose();
    } catch (error) {
      console.error("Failed to save folder preferences:", error);
      setSaveError(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setSaving(false);
      setCloningStatus(null);
    }
  };

  const handleRepoSelect = (repo: CachedGitHubRepository | null) => {
    setSelectedRepo(repo);
    if (repo) {
      setValue("githubRepoId", repo.id);
      // If repo is already cloned, set the working directory
      if (repo.localPath) {
        setValue("defaultWorkingDirectory", repo.localPath);
      }
    } else {
      setValue("githubRepoId", null);
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

  const getInherited = <K extends keyof UpdateFolderPreferencesInput>(
    key: K
  ): string => {
    const userValue = userSettings?.[key as keyof typeof userSettings];
    if (userValue !== null && userValue !== undefined) {
      return String(userValue);
    }
    return String(currentPreferences[key as keyof typeof currentPreferences]);
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
            Override user settings for sessions in this folder.
            Leave empty to inherit from user settings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Linked Repository */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-slate-300">Linked Repository</Label>
              {(selectedRepo || folderPrefs?.githubRepoId) && (
                <span className="text-xs text-violet-400">Configured</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setIsRepoPickerOpen(true)}
              className={cn(
                "w-full flex items-center gap-3 p-3 rounded-lg text-left",
                "border transition-all duration-200",
                selectedRepo
                  ? "border-violet-500/50 bg-violet-500/10"
                  : "border-white/10 bg-slate-800/50 hover:bg-slate-800/80 hover:border-violet-500/30"
              )}
            >
              <Github className="w-4 h-4 text-violet-400 shrink-0" />
              {selectedRepo ? (
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-white truncate block">
                    {selectedRepo.fullName}
                  </span>
                  <span className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                    {selectedRepo.localPath ? (
                      <>
                        <Check className="w-3 h-3 text-green-400" />
                        Cloned
                      </>
                    ) : (
                      <>
                        <Download className="w-3 h-3" />
                        Will be cloned on save
                      </>
                    )}
                  </span>
                </div>
              ) : (
                <span className="text-slate-400 flex-1">Select a repository...</span>
              )}
              {selectedRepo && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRepoSelect(null);
                  }}
                  className="p-1 hover:bg-white/10 rounded text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </button>
            <p className="text-xs text-slate-500">
              Links a GitHub repository to this folder. Non-cloned repos will be cloned automatically.
            </p>
          </div>

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
              placeholder={`Inherit: ${getInherited("defaultWorkingDirectory")}`}
              className={cn(
                "bg-slate-800 border-white/10 text-white placeholder:text-slate-500",
                isOverridden("defaultWorkingDirectory") && "border-violet-500/50"
              )}
            />
            {selectedRepo && !selectedRepo.localPath && (
              <p className="text-xs text-amber-400">
                Working directory will be set to the cloned repo path on save.
              </p>
            )}
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
                  Inherit from user settings
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
                  Inherit from user settings
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
                  Inherit from user settings
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
        </div>

        {/* Error display */}
        {saveError && (
          <p className="text-sm text-red-400 mt-2">{saveError}</p>
        )}

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
              disabled={saving}
              className="text-slate-400 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {cloningStatus || "Saving..."}
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>

      {/* Repository Picker Dialog */}
      <FolderRepositoryPicker
        open={isRepoPickerOpen}
        onClose={() => setIsRepoPickerOpen(false)}
        onSelect={handleRepoSelect}
        selectedRepoId={selectedRepo?.id || folderPrefs?.githubRepoId || null}
      />
    </Dialog>
  );
}
