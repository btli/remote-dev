/**
 * ProjectPrefsPlugin (server half) — lifecycle for the per-project
 * preferences pane.
 *
 * This plugin replaces the modal-based `ProjectPreferencesModal` with a
 * regular terminal-type session. Like Settings / Profiles, it is a pure UI
 * session: no tmux, no shell, no PTY. The server half only seeds the
 * session's `typeMetadata` with the project it is configuring (plus an
 * optional sub-tab) so the client can hydrate on mount and survive reloads.
 *
 * Scope-key dedup: callers set `scopeKey: <projectId>` when creating the
 * session so every project gets at most one preferences tab open at once.
 *
 * @see ./project-prefs-plugin-client.tsx for rendering.
 */

import type {
  TerminalTypeServerPlugin,
  SessionConfig,
  ExitBehavior,
} from "@/types/terminal-type-server";
import type { TerminalSession, CreateSessionInput } from "@/types/session";
import { createLogger } from "@/lib/logger";

const log = createLogger("ProjectPrefsPlugin.Server");

/** Valid sub-tabs reserved for future tab-based navigation. */
export type ProjectPrefsActiveTab =
  | "general"
  | "appearance"
  | "repository"
  | "environment";

/**
 * Metadata persisted with a project-prefs session.
 *
 * `projectId` identifies which project is being configured. It is required
 * at create time (validated by `validateInput`) and surfaces as the
 * scope-key so duplicate opens reuse the same tab.
 *
 * `projectName` is cached on the session so the tab title does not have to
 * re-query the project tree to render.
 *
 * `initialTab` is reserved for future tab-based UX; today the form is a
 * single scrolling column and the value is ignored by the client. It is
 * still threaded through so callers (e.g. the Port Manager's
 * "open-folder-preferences" event) can request a specific starting tab
 * once the UI supports it.
 */
export interface ProjectPrefsSessionMetadata {
  projectId: string;
  projectName: string;
  initialTab?: ProjectPrefsActiveTab | null;
}

const VALID_TABS: ReadonlySet<ProjectPrefsActiveTab> = new Set([
  "general",
  "appearance",
  "repository",
  "environment",
]);

function isValidTab(value: unknown): value is ProjectPrefsActiveTab {
  return (
    typeof value === "string" && VALID_TABS.has(value as ProjectPrefsActiveTab)
  );
}

/** Default project-prefs server plugin instance. */
export const ProjectPrefsServerPlugin: TerminalTypeServerPlugin = {
  type: "project-prefs",
  priority: 65,
  builtIn: true,
  useTmux: false,

  validateInput(input: CreateSessionInput): string | null {
    const md = (input.typeMetadata ?? {}) as Partial<ProjectPrefsSessionMetadata>;
    if (typeof md.projectId !== "string" || md.projectId.trim() === "") {
      return "project-prefs session requires typeMetadata.projectId";
    }
    return null;
  },

  createSession(input: CreateSessionInput): SessionConfig {
    const md = (input.typeMetadata ?? {}) as Partial<ProjectPrefsSessionMetadata>;
    const projectId = typeof md.projectId === "string" ? md.projectId : "";
    const projectName =
      typeof md.projectName === "string" && md.projectName.trim() !== ""
        ? md.projectName
        : "project";
    const initialTab = isValidTab(md.initialTab) ? md.initialTab : null;

    const metadata: ProjectPrefsSessionMetadata = {
      projectId,
      projectName,
      initialTab,
    };

    log.debug("Creating project-prefs session", {
      projectId,
      hasInitialTab: initialTab !== null,
    });

    return {
      shellCommand: null,
      shellArgs: [],
      environment: {},
      useTmux: false,
      metadata: metadata as unknown as Record<string, unknown>,
    };
  },

  onSessionExit(): ExitBehavior {
    return {
      showExitScreen: false,
      canRestart: false,
      autoClose: true,
    };
  },

  onSessionClose(session: TerminalSession): void {
    log.debug("Closing project-prefs session", { sessionId: session.id });
  },

  canHandle(session: TerminalSession): boolean {
    return session.terminalType === "project-prefs";
  },
};
