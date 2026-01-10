"use client";

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Brain } from "lucide-react";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import { cn } from "@/lib/utils";

interface OrchestratorModeToggleProps {
  /**
   * Folder ID to configure. If not provided, updates user-level setting.
   */
  folderId?: string | null;
  /**
   * Optional className for styling
   */
  className?: string;
}

/**
 * OrchestratorModeToggle - Toggle for enabling orchestrator-first mode
 *
 * Orchestrator-first mode enables the Master Control system to automatically
 * monitor sessions and detect stalls, providing AI-assisted intervention.
 *
 * Can be configured at:
 * - User level: Default for all folders
 * - Folder level: Override for specific folders (inherits to children)
 */
export function OrchestratorModeToggle({
  folderId,
  className,
}: OrchestratorModeToggleProps) {
  const {
    userSettings,
    currentPreferences,
    updateUserSettings,
    updateFolderPreferences,
    loading,
  } = usePreferencesContext();

  // Get the current value based on context
  const isEnabled = folderId
    ? currentPreferences?.orchestratorFirstMode ?? false
    : userSettings?.orchestratorFirstMode ?? false;

  // Get the source of the current value
  const source = currentPreferences?.source?.orchestratorFirstMode;
  const sourceFolder = source && typeof source === "object" ? source : null;

  // Check if current folder has its own override (vs inherited from parent/user)
  const hasLocalOverride = folderId && sourceFolder?.folderId === folderId;

  // Check if value is inherited from a parent folder (not the current folder)
  const isInheritedFromParent = folderId && sourceFolder && sourceFolder.folderId !== folderId;
  const inheritedFrom = isInheritedFromParent ? sourceFolder.folderName : null;

  const handleToggle = async (checked: boolean) => {
    if (folderId) {
      // Update folder-level preference
      await updateFolderPreferences(folderId, {
        orchestratorFirstMode: checked,
      });
    } else {
      // Update user-level preference
      await updateUserSettings({
        orchestratorFirstMode: checked,
      });
    }
  };

  const handleClearOverride = async () => {
    if (folderId) {
      // Set to null to inherit from parent/user
      await updateFolderPreferences(folderId, {
        orchestratorFirstMode: null,
      });
    }
  };

  return (
    <div className={cn("flex items-center justify-between gap-4", className)}>
      <div className="flex items-center gap-3">
        <Brain
          className={cn(
            "h-5 w-5",
            isEnabled ? "text-primary" : "text-muted-foreground"
          )}
        />
        <div className="space-y-0.5">
          <Label
            htmlFor="orchestrator-mode"
            className="text-sm font-medium cursor-pointer"
          >
            Orchestrator-First Mode
          </Label>
          <p className="text-xs text-muted-foreground">
            Enable AI-assisted session monitoring and stall detection
            {inheritedFrom && (
              <span className="ml-1 text-primary/80">
                (inherited from {inheritedFrom})
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {hasLocalOverride && (
          <button
            onClick={handleClearOverride}
            className="text-xs text-muted-foreground hover:text-foreground"
            type="button"
          >
            Clear override
          </button>
        )}
        <Switch
          id="orchestrator-mode"
          checked={isEnabled}
          onCheckedChange={handleToggle}
          disabled={loading}
        />
      </div>
    </div>
  );
}

/**
 * OrchestratorModeCard - Card wrapper for the toggle with additional context
 */
export function OrchestratorModeCard({
  folderId,
  className,
}: OrchestratorModeToggleProps) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-4 space-y-3",
        className
      )}
    >
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium">Master Control</h3>
      </div>
      <OrchestratorModeToggle folderId={folderId} />
      <p className="text-xs text-muted-foreground">
        When enabled, Master Control monitors all terminal sessions for stalls
        and provides suggested interventions. This is especially useful for
        long-running AI agent tasks.
      </p>
    </div>
  );
}
