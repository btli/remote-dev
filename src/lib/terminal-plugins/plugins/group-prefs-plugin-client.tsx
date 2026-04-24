/**
 * GroupPrefsPlugin (client half) — React rendering for per-group preferences.
 *
 * Wraps the dialog-free `GroupPreferencesView` in a scroll container so the
 * preferences form fills the pane. Closing (Escape / X) routes through
 * `onSessionClose`; the tab is scope-key-deduped on `groupId`, so reopening
 * via the sidebar gear simply recreates it.
 *
 * @see ./group-prefs-plugin-server.ts for lifecycle.
 */

import { useCallback } from "react";
import { FolderCog } from "lucide-react";
import type {
  TerminalTypeClientPlugin,
  TerminalTypeClientComponentProps,
} from "@/types/terminal-type-client";
import type { TerminalSession } from "@/types/session";
import { GroupPreferencesView } from "@/components/preferences/GroupPreferencesView";
import type { GroupPrefsSessionMetadata } from "./group-prefs-plugin-server";

function readMetadata(
  session: TerminalSession
): GroupPrefsSessionMetadata | null {
  const md = session.typeMetadata as
    | Partial<GroupPrefsSessionMetadata>
    | null
    | undefined;
  if (!md || typeof md.groupId !== "string" || md.groupId.length === 0) {
    return null;
  }
  return {
    groupId: md.groupId,
    groupName: typeof md.groupName === "string" ? md.groupName : "",
  };
}

function GroupPrefsTabContent({
  session,
  onSessionClose,
}: TerminalTypeClientComponentProps) {
  const meta = readMetadata(session);

  const handleClose = useCallback(() => {
    onSessionClose?.(session.id);
  }, [onSessionClose, session.id]);

  if (!meta) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        <p>
          Group-preferences tab is missing its <code>groupId</code>. Close this
          tab and reopen from the sidebar.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-auto">
      <div className="mx-auto w-full max-w-2xl px-6 py-6">
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-foreground">
            Group Preferences
          </h2>
          <p className="text-sm text-muted-foreground">
            Shared defaults for{" "}
            {meta.groupName ? <strong>{meta.groupName}</strong> : "this group"}{" "}
            and all descendant projects. Project-specific fields (repository,
            agent) live on each project.
          </p>
        </div>
        <GroupPreferencesView
          groupId={meta.groupId}
          groupName={meta.groupName}
          onClose={handleClose}
        />
      </div>
    </div>
  );
}

/** Default group-prefs client plugin instance */
export const GroupPrefsClientPlugin: TerminalTypeClientPlugin = {
  type: "group-prefs",
  displayName: "Group Preferences",
  description: "Shared defaults for a group and its descendants",
  icon: FolderCog,
  priority: 65,
  builtIn: true,
  component: GroupPrefsTabContent,
  deriveTitle: (session) => {
    const meta = readMetadata(session);
    if (!meta) return null;
    const label = meta.groupName?.trim() || "Group";
    return `Prefs — ${label}`;
  },
};
