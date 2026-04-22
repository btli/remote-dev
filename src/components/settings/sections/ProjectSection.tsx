"use client";

import { Bell, Folder, Pin, PinOff } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import { useProjectTree } from "@/contexts/ProjectTreeContext";
import { useNotificationPermission } from "@/hooks/useNotificationPermission";
import { cn } from "@/lib/utils";

export function ProjectSection() {
  const {
    userSettings,
    updateUserSettings,
    activeProject,
    setActiveFolder,
  } = usePreferencesContext();
  const { projects } = useProjectTree();
  const { permissionState, requestPermission } = useNotificationPermission();

  return (
    <div className="space-y-4">
      {/* Auto-follow toggle */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
        <div className="space-y-0.5">
          <Label className="text-foreground">Auto-follow active session</Label>
          <p className="text-xs text-muted-foreground">
            Automatically switch active project based on selected session
          </p>
        </div>
        <Switch
          checked={userSettings?.autoFollowActiveSession ?? true}
          onCheckedChange={(checked) =>
            updateUserSettings({ autoFollowActiveSession: checked })
          }
        />
      </div>

      {/* Agent notifications toggle */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <Label className="text-foreground">Agent notifications</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            Browser notifications when agents finish, need input, or encounter
            errors
          </p>
          {permissionState === "denied" && (
            <p className="text-xs text-destructive">
              Notifications are blocked by your browser. Update your browser
              settings to allow them.
            </p>
          )}
        </div>
        <Switch
          checked={userSettings?.notificationsEnabled ?? true}
          onCheckedChange={async (checked) => {
            if (checked && permissionState === "default") {
              const result = await requestPermission();
              if (result === "denied") return;
            }
            updateUserSettings({ notificationsEnabled: checked });
          }}
        />
      </div>

      {/* Active project display */}
      <div className="space-y-2">
        <Label className="text-foreground">Active Project</Label>
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground p-3 rounded-lg bg-muted/50 border border-border">
            No projects created yet. Create a project to set it as active.
          </p>
        ) : (
          <div className="space-y-1">
            {projects.map((project) => {
              const isActive = activeProject.folderId === project.id;
              const isPinned = isActive && activeProject.isPinned;

              return (
                <div
                  key={project.id}
                  className={cn(
                    "flex items-center justify-between p-2 rounded-lg",
                    "transition-colors cursor-pointer",
                    isActive
                      ? "bg-primary/20 border border-primary/30"
                      : "bg-muted/50 border border-border hover:bg-muted"
                  )}
                  onClick={() => setActiveFolder(project.id, false)}
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
                      {project.name}
                    </span>
                  </div>
                  {isActive && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveFolder(project.id, !isPinned);
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
    </div>
  );
}
