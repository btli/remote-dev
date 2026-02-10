"use client";

import { useState, useEffect, useCallback } from "react";
import { Settings, Terminal, Palette, Folder, Pin, PinOff, Server, Sparkles } from "lucide-react";
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
import { UnsavedChangesDialog } from "@/components/common/UnsavedChangesDialog";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import { useFolderContext } from "@/contexts/FolderContext";
import { AppearanceModeToggle, ColorSchemeDualSelector } from "@/components/appearance";
import { TmuxSessionManager } from "@/components/tmux";
import { AgentCLIStatusPanel } from "@/components/agents";
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

  // Check if there are unsaved changes
  const hasChanges = Object.keys(localSettings).length > 0;

  // Handle close with unsaved changes warning
  const handleActualClose = useCallback(() => {
    setLocalSettings({});
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
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] flex flex-col bg-popover/95 backdrop-blur-xl border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Settings className="w-5 h-5 text-primary" />
            User Settings
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Configure your default preferences. These can be overridden per folder.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="terminal" className="mt-4 flex-1 flex flex-col min-h-0 overflow-hidden">
          <TabsList className="inline-flex w-full justify-center gap-0.5 bg-muted/50 h-auto p-1 rounded-lg shrink-0 overflow-x-auto">
            <TabsTrigger value="terminal" className="!flex-none flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-md text-sm data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm">
              <Terminal className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">Terminal</span>
            </TabsTrigger>
            <TabsTrigger value="appearance" className="!flex-none flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-md text-sm data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm">
              <Palette className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">Appearance</span>
            </TabsTrigger>
            <TabsTrigger value="agents" className="!flex-none flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-md text-sm data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm">
              <Sparkles className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">Agents</span>
            </TabsTrigger>
            <TabsTrigger value="project" className="!flex-none flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-md text-sm data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm">
              <Folder className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">Project</span>
            </TabsTrigger>
            <TabsTrigger value="system" className="!flex-none flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-md text-sm data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm">
              <Server className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">System</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="terminal" className="space-y-4 mt-4 flex-1 overflow-y-auto overflow-x-hidden pr-2 isolate">
            {/* Working Directory */}
            <div className="space-y-2">
              <Label className="text-foreground">Default Working Directory</Label>
              <Input
                value={getValue("defaultWorkingDirectory") || ""}
                onChange={(e) => setValue("defaultWorkingDirectory", e.target.value || null)}
                placeholder="~/projects"
                className="bg-input border-border text-foreground placeholder:text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to use your home directory
              </p>
            </div>

            {/* Shell */}
            <div className="space-y-2">
              <Label className="text-foreground">Default Shell</Label>
              <Select
                value={getValue("defaultShell") || "/bin/bash"}
                onValueChange={(value) => setValue("defaultShell", value)}
              >
                <SelectTrigger className="bg-input border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {SHELL_OPTIONS.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className="text-popover-foreground focus:bg-primary/20"
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Startup Command */}
            <div className="space-y-2">
              <Label className="text-foreground">Startup Command</Label>
              <Input
                value={getValue("startupCommand") || ""}
                onChange={(e) => setValue("startupCommand", e.target.value || null)}
                placeholder="claude"
                className="bg-input border-border text-foreground placeholder:text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">
                Command to run when a new session starts (e.g., claude, clauded)
              </p>
            </div>

            {/* Scrollback Buffer Settings */}
            <div className="pt-4 border-t border-border">
              <Label className="text-foreground text-sm font-medium">Scrollback Buffer</Label>
              <p className="text-xs text-muted-foreground mt-1 mb-4">
                Reduce these values if you experience performance issues with long-running sessions.
                Changes apply to new sessions only.
              </p>

              {/* xterm.js Scrollback */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-foreground text-sm">Terminal (xterm.js)</Label>
                  <span className="text-sm text-muted-foreground">
                    {(getValue("xtermScrollback") || 10000).toLocaleString()} lines
                  </span>
                </div>
                <Slider
                  value={[getValue("xtermScrollback") || 10000]}
                  onValueChange={([value]) => setValue("xtermScrollback", value)}
                  min={1000}
                  max={50000}
                  step={1000}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  Client-side scrollback buffer for the terminal display
                </p>
              </div>

              {/* tmux History Limit */}
              <div className="space-y-2 mt-4">
                <div className="flex items-center justify-between">
                  <Label className="text-foreground text-sm">Server (tmux)</Label>
                  <span className="text-sm text-muted-foreground">
                    {(getValue("tmuxHistoryLimit") || 50000).toLocaleString()} lines
                  </span>
                </div>
                <Slider
                  value={[getValue("tmuxHistoryLimit") || 50000]}
                  onValueChange={([value]) => setValue("tmuxHistoryLimit", value)}
                  min={1000}
                  max={100000}
                  step={5000}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  Server-side scrollback buffer stored in tmux (persistent)
                </p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="appearance" className="space-y-4 mt-4 flex-1 overflow-y-auto overflow-x-hidden pr-2 isolate">
            {/* Appearance Mode (Light/System/Dark) */}
            <div className="space-y-2">
              <Label className="text-foreground">Appearance Mode</Label>
              <AppearanceModeToggle />
              <p className="text-xs text-muted-foreground">
                Choose light, dark, or follow your system preference
              </p>
            </div>

            {/* Color Schemes */}
            <div className="space-y-2">
              <Label className="text-foreground">Color Schemes</Label>
              <p className="text-xs text-muted-foreground mb-3">
                Select different color schemes for light and dark modes
              </p>
              <ColorSchemeDualSelector />
            </div>

            {/* Font Size */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-foreground">Font Size</Label>
                <span className="text-sm text-muted-foreground">
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
              <Label className="text-foreground">Font Family</Label>
              <Select
                value={getValue("fontFamily") || "'JetBrainsMono Nerd Font Mono', monospace"}
                onValueChange={(value) => setValue("fontFamily", value)}
              >
                <SelectTrigger className="bg-input border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {FONT_OPTIONS.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className="text-popover-foreground focus:bg-primary/20"
                      style={{ fontFamily: option.value }}
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </TabsContent>

          <TabsContent value="agents" className="space-y-4 mt-4 flex-1 overflow-y-auto overflow-x-hidden pr-2 isolate">
            <AgentCLIStatusPanel />
          </TabsContent>

          <TabsContent value="project" className="space-y-4 mt-4 flex-1 overflow-y-auto overflow-x-hidden pr-2 isolate">
            {/* Auto-follow toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
              <div className="space-y-0.5">
                <Label className="text-foreground">Auto-follow active session</Label>
                <p className="text-xs text-muted-foreground">
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
              <Label className="text-foreground">Active Project</Label>
              {folders.length === 0 ? (
                <p className="text-sm text-muted-foreground p-3 rounded-lg bg-muted/50 border border-border">
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
                            ? "bg-primary/20 border border-primary/30"
                            : "bg-muted/50 border border-border hover:bg-muted"
                        )}
                        onClick={() => setActiveFolder(folder.id, false)}
                      >
                        <div className="flex items-center gap-2">
                          <Folder
                            className={cn(
                              "w-4 h-4",
                              isActive
                                ? "text-primary fill-primary/30"
                                : "text-muted-foreground"
                            )}
                          />
                          <span
                            className={cn(
                              "text-sm",
                              isActive ? "text-foreground" : "text-muted-foreground"
                            )}
                          >
                            {folder.name}
                          </span>
                        </div>
                        {isActive && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveFolder(folder.id, !isPinned);
                            }}
                            title={isPinned ? "Unpin project" : "Pin project"}
                          >
                            {isPinned ? (
                              <Pin className="w-3.5 h-3.5 fill-primary text-primary" />
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
              <p className="text-xs text-muted-foreground">
                Pin a project to prevent auto-follow from switching it
              </p>
            </div>
          </TabsContent>

          <TabsContent value="system" className="space-y-4 mt-4 flex-1 overflow-y-auto overflow-x-hidden pr-2 isolate">
            <TmuxSessionManager />
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 pt-4 border-t border-border shrink-0">
          <Button
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            className="text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <UnsavedChangesDialog
      open={showUnsavedDialog}
      onDiscard={handleDiscard}
      onCancel={handleCancelClose}
    />
    </>
  );
}
