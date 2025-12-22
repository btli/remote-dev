"use client";

import { useState, useEffect } from "react";
import { Folder, RotateCcw } from "lucide-react";
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
import type { UpdateFolderPreferencesInput } from "@/types/preferences";
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
    userSettings,
    currentPreferences,
  } = usePreferencesContext();

  const [localSettings, setLocalSettings] = useState<UpdateFolderPreferencesInput>({});
  const [saving, setSaving] = useState(false);

  const folderPrefs = getFolderPreferences(folderId);

  // Reset local settings when modal opens
  useEffect(() => {
    if (open) {
      setLocalSettings({});
    }
  }, [open]);

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
