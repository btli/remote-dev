/**
 * SecretsPlugin (client half) — React rendering for the per-project Secrets
 * configuration pane.
 *
 * Wraps the shared `SecretsConfigView` component (the Dialog-less extraction
 * of the legacy `SecretsConfigModal`). The session's `typeMetadata.projectId`
 * seeds the view so the configure-tab pre-selects the right project on
 * mount; reloads restore the same view via the persisted metadata.
 *
 * Dismiss semantics: Escape / the close button routes through
 * `onSessionClose`, matching the modal UX. Because the session is
 * scope-key-deduped on projectId, reopening Secrets for the same project
 * from the sidebar cheaply recreates the tab.
 *
 * @see ./secrets-plugin-server.ts for lifecycle.
 */

"use client";

import { useCallback } from "react";
import { KeyRound } from "lucide-react";
import type {
  TerminalTypeClientPlugin,
  TerminalTypeClientComponentProps,
} from "@/types/terminal-type-client";
import type { TerminalSession } from "@/types/session";
import { SecretsConfigView } from "@/components/secrets/SecretsConfigView";
import type { SecretsSessionMetadata } from "./secrets-plugin-server";

function readSecretsMetadata(
  session: TerminalSession
): SecretsSessionMetadata | null {
  const md = session.typeMetadata;
  if (!md || typeof md !== "object") return null;
  const record = md as Record<string, unknown>;
  if (typeof record.projectId !== "string" || record.projectId.length === 0) {
    return null;
  }
  const projectName =
    typeof record.projectName === "string" ? record.projectName : "";
  return { projectId: record.projectId, projectName };
}

function SecretsTabContent({
  session,
  onSessionClose,
}: TerminalTypeClientComponentProps) {
  const metadata = readSecretsMetadata(session);

  const handleClose = useCallback(() => {
    onSessionClose?.(session.id);
  }, [onSessionClose, session.id]);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <SecretsConfigView
        initialFolderId={metadata?.projectId ?? null}
        onClose={handleClose}
      />
    </div>
  );
}

/** Default secrets client plugin instance */
export const SecretsClientPlugin: TerminalTypeClientPlugin = {
  type: "secrets",
  displayName: "Secrets",
  description: "Per-project secrets configuration",
  icon: KeyRound,
  priority: 62,
  builtIn: true,
  component: SecretsTabContent,
  deriveTitle(session: TerminalSession): string | null {
    const md = readSecretsMetadata(session);
    if (!md) return null;
    return md.projectName ? `Secrets — ${md.projectName}` : "Secrets";
  },
};
