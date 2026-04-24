"use client";

/**
 * SecretsStatusButton - Header indicator for secrets management
 *
 * Shows connection status and opens the per-project Secrets configuration
 * tab via the `open-secrets` CustomEvent (handled by SessionManager).
 * Follows the same pattern as the Settings gear button.
 */

import { KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSecretsContext } from "@/contexts/SecretsContext";
import { usePreferencesContext } from "@/contexts/PreferencesContext";

export function SecretsStatusButton() {
  const { folderConfigs, loading } = useSecretsContext();
  const { activeProject } = usePreferencesContext();

  // Check if active folder has secrets configured
  const activeConfig = activeProject.folderId
    ? folderConfigs.get(activeProject.folderId)
    : null;

  const hasSecretsConfigured = activeConfig && activeConfig.enabled;

  // Determine display state
  const isConnected = hasSecretsConfigured;

  const tooltipLabel = isConnected
    ? `Secrets: ${activeConfig?.provider}`
    : "Secrets";

  const handleClick = () => {
    window.dispatchEvent(
      new CustomEvent("open-secrets", {
        detail: {
          projectId: activeProject.folderId,
          projectName: activeProject.folderName,
        },
      })
    );
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={loading || !activeProject.folderId}
          onClick={handleClick}
        >
          <KeyRound
            className={cn(
              "h-4 w-4 transition-colors",
              isConnected ? "text-green-400" : "text-muted-foreground"
            )}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltipLabel}</TooltipContent>
    </Tooltip>
  );
}
