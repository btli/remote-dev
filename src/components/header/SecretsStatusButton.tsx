"use client";

/**
 * SecretsStatusButton - Header indicator for secrets management
 *
 * Shows connection status and opens the secrets configuration modal.
 * Follows the same pattern as GitHubConnectButton.
 */

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SecretsConfigModal } from "@/components/secrets/SecretsConfigModal";
import { useSecretsContext } from "@/contexts/SecretsContext";
import { usePreferencesContext } from "@/contexts/PreferencesContext";

export function SecretsStatusButton() {
  const [modalOpen, setModalOpen] = useState(false);
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

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={loading}
            onClick={() => setModalOpen(true)}
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

      <SecretsConfigModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
