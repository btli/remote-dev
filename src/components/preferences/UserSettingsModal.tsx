"use client";

import { useState, useEffect } from "react";
import { Settings, Terminal, Palette, Folder, Pin, PinOff } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import { useFolderContext } from "@/contexts/FolderContext";
import type { UpdateUserSettingsInput } from "@/types/preferences";
import { cn } from "@/lib/utils";

interface UserSettingsModalProps {
  open: boolean;
  onClose: () => void;
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

export function UserSettingsModal({ open, onClose }: UserSettingsModalProps) {
  const {
    userSettings,
    updateUserSettings,
    activeProject,
    setActiveFolder,
  } = usePreferencesContext();
  const { folders } = useFolderContext();

  const [localSettings, setLocalSettings] = useState<UpdateUserSettingsInput>({});
  const [saving, setSaving] = useState(false);

  // Reset local settings when modal opens
  useEffect(() => {
    if (open && userSettings) {
      setLocalSettings({});
    }
  }, [open, userSettings]);

  const handleSave = async () => {
    if (Object.keys(localSettings).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      await updateUserSettings(localSettings);
      onClose();
    } catch (error) {
      console.error("Failed to save settings:", error);
    } finally {
      setSaving(false);
    }
  };

  const getValue = <K extends keyof UpdateUserSettingsInput>(
    key: K
  ): UpdateUserSettingsInput[K] | null => {
    if (key in localSettings) {
      return localSettings[key] as UpdateUserSettingsInput[K];
    }
    return userSettings?.[key as keyof typeof userSettings] as UpdateUserSettingsInput[K] | null;
  };

  const setValue = <K extends keyof UpdateUserSettingsInput>(
    key: K,
    value: UpdateUserSettingsInput[K]
  ) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[550px] bg-slate-900 border-white/10">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Settings className="w-5 h-5 text-violet-400" />
            User Settings
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Configure your default preferences. These can be overridden per folder.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="terminal" className="mt-4">
          <TabsList className="grid w-full grid-cols-3 bg-slate-800/50">
            <TabsTrigger value="terminal" className="data-[state=active]:bg-violet-500/20">
              <Terminal className="w-4 h-4 mr-2" />
              Terminal
            </TabsTrigger>
            <TabsTrigger value="appearance" className="data-[state=active]:bg-violet-500/20">
              <Palette className="w-4 h-4 mr-2" />
              Appearance
            </TabsTrigger>
            <TabsTrigger value="project" className="data-[state=active]:bg-violet-500/20">
              <Folder className="w-4 h-4 mr-2" />
              Project
            </TabsTrigger>
          </TabsList>

          <TabsContent value="terminal" className="space-y-4 mt-4">
            {/* Working Directory */}
            <div className="space-y-2">
              <Label className="text-slate-300">Default Working Directory</Label>
              <Input
                value={getValue("defaultWorkingDirectory") || ""}
                onChange={(e) => setValue("defaultWorkingDirectory", e.target.value || null)}
                placeholder="~/projects"
                className="bg-slate-800 border-white/10 text-white placeholder:text-slate-500"
              />
              <p className="text-xs text-slate-500">
                Leave empty to use your home directory
              </p>
            </div>

            {/* Shell */}
            <div className="space-y-2">
              <Label className="text-slate-300">Default Shell</Label>
              <Select
                value={getValue("defaultShell") || "/bin/bash"}
                onValueChange={(value) => setValue("defaultShell", value)}
              >
                <SelectTrigger className="bg-slate-800 border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-white/10">
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
              <Label className="text-slate-300">Startup Command</Label>
              <Input
                value={getValue("startupCommand") || ""}
                onChange={(e) => setValue("startupCommand", e.target.value || null)}
                placeholder="claude"
                className="bg-slate-800 border-white/10 text-white placeholder:text-slate-500"
              />
              <p className="text-xs text-slate-500">
                Command to run when a new session starts (e.g., claude, clauded)
              </p>
            </div>
          </TabsContent>

          <TabsContent value="appearance" className="space-y-4 mt-4">
            {/* Theme */}
            <div className="space-y-2">
              <Label className="text-slate-300">Theme</Label>
              <Select
                value={getValue("theme") || "tokyo-night"}
                onValueChange={(value) => setValue("theme", value)}
              >
                <SelectTrigger className="bg-slate-800 border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-white/10">
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
                  {getValue("fontSize") || 14}px
                </span>
              </div>
              <Slider
                value={[getValue("fontSize") || 14]}
                onValueChange={([value]) => setValue("fontSize", value)}
                min={10}
                max={24}
                step={1}
                className="w-full"
              />
            </div>

            {/* Font Family */}
            <div className="space-y-2">
              <Label className="text-slate-300">Font Family</Label>
              <Select
                value={getValue("fontFamily") || "'JetBrainsMono Nerd Font Mono', monospace"}
                onValueChange={(value) => setValue("fontFamily", value)}
              >
                <SelectTrigger className="bg-slate-800 border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-white/10">
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

          <TabsContent value="project" className="space-y-4 mt-4">
            {/* Auto-follow toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50 border border-white/5">
              <div className="space-y-0.5">
                <Label className="text-slate-300">Auto-follow active session</Label>
                <p className="text-xs text-slate-500">
                  Automatically switch active project based on selected session
                </p>
              </div>
              <Switch
                checked={getValue("autoFollowActiveSession") ?? true}
                onCheckedChange={(checked) =>
                  setValue("autoFollowActiveSession", checked)
                }
              />
            </div>

            {/* Active project display */}
            <div className="space-y-2">
              <Label className="text-slate-300">Active Project</Label>
              {folders.length === 0 ? (
                <p className="text-sm text-slate-500 p-3 rounded-lg bg-slate-800/50 border border-white/5">
                  No folders created yet. Create a folder to set it as active.
                </p>
              ) : (
                <div className="space-y-1">
                  {folders.map((folder) => {
                    const isActive = activeProject.folderId === folder.id;
                    const isPinned = isActive && activeProject.isPinned;

                    return (
                      <div
                        key={folder.id}
                        className={cn(
                          "flex items-center justify-between p-2 rounded-lg",
                          "transition-colors cursor-pointer",
                          isActive
                            ? "bg-violet-500/20 border border-violet-500/30"
                            : "bg-slate-800/50 border border-white/5 hover:bg-slate-800"
                        )}
                        onClick={() => setActiveFolder(folder.id, false)}
                      >
                        <div className="flex items-center gap-2">
                          <Folder
                            className={cn(
                              "w-4 h-4",
                              isActive
                                ? "text-violet-400 fill-violet-400/30"
                                : "text-slate-400"
                            )}
                          />
                          <span
                            className={cn(
                              "text-sm",
                              isActive ? "text-white" : "text-slate-300"
                            )}
                          >
                            {folder.name}
                          </span>
                        </div>
                        {isActive && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-slate-400 hover:text-white"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveFolder(folder.id, !isPinned);
                            }}
                            title={isPinned ? "Unpin project" : "Pin project"}
                          >
                            {isPinned ? (
                              <Pin className="w-3.5 h-3.5 fill-violet-400 text-violet-400" />
                            ) : (
                              <PinOff className="w-3.5 h-3.5" />
                            )}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="text-xs text-slate-500">
                Pin a project to prevent auto-follow from switching it
              </p>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 pt-4 border-t border-white/5">
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
      </DialogContent>
    </Dialog>
  );
}
