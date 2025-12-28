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
  const hasAnyConfigs = folderConfigs.size > 0;

  // Determine display state
  const isConnected = hasSecretsConfigured;

  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        className={cn(
          "flex items-center gap-2 text-sm transition-colors",
          "hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          loading && "opacity-50"
        )}
        title={
          isConnected
            ? `Secrets: ${activeConfig?.provider}`
            : hasAnyConfigs
              ? "Configure secrets for this folder"
              : "Set up secrets management"
        }
      >
        <KeyRound
          className={cn(
            "w-4 h-4 transition-colors",
            isConnected ? "text-green-400" : "text-muted-foreground"
          )}
        />
      </button>

      <SecretsConfigModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
