/**
 * ProjectPrefsPlugin (client half) — React rendering for the per-project
 * preferences pane.
 *
 * Wraps the extracted `ProjectPreferencesView` in a flex container sized
 * to the pane. Dialog-wrapping behavior from the legacy
 * `ProjectPreferencesModal` is intentionally dropped: the session is a
 * real terminal-type tab now and its tab header + close affordance live
 * in the outer chrome.
 *
 * Dismissal: Save / Reset / Cancel all call `onDone`, which routes to
 * `onSessionClose` — matching the modal UX where any of those actions
 * closed the dialog. Scope-key dedup means re-opening the same project's
 * prefs reuses the open tab rather than stacking.
 *
 * @see ./project-prefs-plugin-server.ts for lifecycle.
 */

import { useCallback } from "react";
import { Settings2 } from "lucide-react";
import type {
  TerminalTypeClientPlugin,
  TerminalTypeClientComponentProps,
} from "@/types/terminal-type-client";
import type { TerminalSession } from "@/types/session";
import { ProjectPreferencesView } from "@/components/preferences/ProjectPreferencesView";
import type { ProjectPrefsSessionMetadata } from "./project-prefs-plugin-server";

function readMetadata(
  metadata: TerminalSession["typeMetadata"]
): ProjectPrefsSessionMetadata | null {
  if (!metadata || typeof metadata !== "object") return null;
  const md = metadata as Partial<ProjectPrefsSessionMetadata>;
  if (typeof md.projectId !== "string" || md.projectId.trim() === "") {
    return null;
  }
  const projectName =
    typeof md.projectName === "string" && md.projectName.trim() !== ""
      ? md.projectName
      : "project";
  return {
    projectId: md.projectId,
    projectName,
    initialTab: md.initialTab ?? null,
  };
}

function ProjectPrefsTabContent({
  session,
  onSessionClose,
}: TerminalTypeClientComponentProps) {
  const metadata = readMetadata(session.typeMetadata);

  const handleDone = useCallback(() => {
    onSessionClose?.(session.id);
  }, [onSessionClose, session.id]);

  if (!metadata) {
    return (
      <div className="flex flex-col h-full min-h-0 overflow-hidden">
        <div className="p-6 text-sm text-destructive">
          Project preferences session is missing its projectId metadata.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-4">
        <div className="mx-auto w-full max-w-2xl">
          <h2 className="text-xl font-semibold text-foreground">
            Project Preferences
          </h2>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">
            Overrides and project-specific settings for{" "}
            <strong>{metadata.projectName}</strong>. Values fall back through
            parent groups when unset.
          </p>
          <ProjectPreferencesView
            projectId={metadata.projectId}
            projectName={metadata.projectName}
            initialTab={metadata.initialTab ?? null}
            onDone={handleDone}
          />
        </div>
      </div>
    </div>
  );
}

/** Default project-prefs client plugin instance. */
export const ProjectPrefsClientPlugin: TerminalTypeClientPlugin = {
  type: "project-prefs",
  displayName: "Project Preferences",
  description: "Edit project preferences",
  icon: Settings2,
  priority: 65,
  builtIn: true,
  component: ProjectPrefsTabContent,
  deriveTitle: (session) => {
    const metadata = readMetadata(session.typeMetadata);
    if (!metadata) return null;
    return `Prefs — ${metadata.projectName}`;
  },
};
