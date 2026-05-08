"use client";

/**
 * NewSessionSheet — Phase 2 mobile redesign.
 *
 * Wraps {@link NewSessionWizard} in a tall (92dvh) {@link BottomSheet} so
 * the existing multi-step wizard is usable on a phone without redesigning
 * its internals. We don't redesign the wizard; we only own the slide-up
 * presentation, viewport sizing, and the create-session callback wiring.
 *
 * **Provider scope (c9aq):** The wizard consumes `ProfileContext` +
 * `TemplateContext`, and this sheet is `dynamic(ssr: false)` from
 * `SessionsTab`, so we mount those providers *here* — they only
 * initialize (and fetch) when the user taps "+ New" on mobile, instead
 * of hydrating with the initial mobile bundle. Desktop continues to
 * hydrate them eagerly via `DesktopProviders`.
 */

import { useCallback } from "react";

import { useSessionContext } from "@/contexts/SessionContext";
import { useProjectTree } from "@/contexts/ProjectTreeContext";
import { ProfileProvider } from "@/contexts/ProfileContext";
import { TemplateProvider } from "@/contexts/TemplateContext";
import { NewSessionWizard } from "@/components/session/NewSessionWizard";

import { BottomSheet } from "../common/BottomSheet";

export interface NewSessionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isGitHubConnected: boolean;
  /** Optional callback fired after the wizard creates a session. */
  onCreated?: (sessionId: string) => void;
}

export function NewSessionSheet({
  open,
  onOpenChange,
  isGitHubConnected,
  onCreated,
}: NewSessionSheetProps) {
  const { createSession } = useSessionContext();
  const projectTree = useProjectTree();

  const handleCreate = useCallback(
    async (data: Parameters<Parameters<typeof NewSessionWizard>[0]["onCreate"]>[0]) => {
      // Mirror the desktop SessionManager: prefer explicit projectId from
      // the wizard, fall back to the active project node when present, else
      // pass undefined and let SessionContext throw.
      const fallbackProjectId =
        projectTree.activeNode?.type === "project" ? projectTree.activeNode.id : undefined;
      const resolvedProjectId = data.projectId ?? fallbackProjectId;

      const payload = {
        ...data,
        projectId: resolvedProjectId,
      };
      delete (payload as Record<string, unknown>).folderId;

      const created = await createSession(payload);
      if (created) {
        onOpenChange(false);
        onCreated?.(created.id);
      }
    },
    [createSession, projectTree.activeNode, onOpenChange, onCreated]
  );

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      ariaLabel="New session"
      size="tall"
    >
      <div className="px-2 pb-2 pt-1" data-testid="mobile-new-session-wrap">
        {open ? (
          <ProfileProvider>
            <TemplateProvider>
              <NewSessionWizard
                open={open}
                onClose={() => onOpenChange(false)}
                onCreate={handleCreate}
                isGitHubConnected={isGitHubConnected}
              />
            </TemplateProvider>
          </ProfileProvider>
        ) : null}
      </div>
    </BottomSheet>
  );
}
