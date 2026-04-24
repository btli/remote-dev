/**
 * GroupPrefsPlugin (server half) — lifecycle for a per-group preferences tab.
 *
 * Groups are containers, not session owners — `terminal_session.project_id` is
 * a NOT NULL FK onto `projects.id`. So a group-prefs session needs a
 * *carrier* project: the client picks a descendant project (or any available
 * project) purely to satisfy the FK. The sidebar renders group-prefs sessions
 * under their *group* (resolved via `typeMetadata.groupId`), NOT under the
 * carrier project. See `project-tree-session-utils.ts::sessionsForGroup`.
 *
 * Dedup: callers pass `scopeKey: groupId` so repeated "Open group preferences"
 * clicks reuse the same tab instead of spawning duplicates.
 *
 * @see ./group-prefs-plugin-client.tsx for rendering.
 */

import type {
  TerminalTypeServerPlugin,
  SessionConfig,
  ExitBehavior,
} from "@/types/terminal-type-server";
import type { TerminalSession, CreateSessionInput } from "@/types/session";
import { createLogger } from "@/lib/logger";

const log = createLogger("GroupPrefsPlugin.Server");

/**
 * Metadata persisted with a group-prefs session.
 *
 * `groupId` is the target the preferences view should load. The server trusts
 * the client to supply a real group id; preference reads/writes go through
 * `/api/node-preferences/group/:groupId` which enforces ownership.
 *
 * `groupName` is a cache for the session tab title. Preference displays
 * re-fetch it from the group tree on mount anyway, so a stale value here
 * just means the tab label is stale until the user reopens the tab.
 */
export interface GroupPrefsSessionMetadata {
  groupId: string;
  groupName: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Default group-prefs server plugin instance */
export const GroupPrefsServerPlugin: TerminalTypeServerPlugin = {
  type: "group-prefs",
  priority: 65,
  builtIn: true,
  useTmux: false,

  validateInput(input: CreateSessionInput): string | null {
    const md = (input.typeMetadata ?? {}) as Partial<GroupPrefsSessionMetadata>;
    if (!isNonEmptyString(md.groupId)) {
      return "group-prefs session requires typeMetadata.groupId";
    }
    return null;
  },

  createSession(input: CreateSessionInput): SessionConfig {
    const md = (input.typeMetadata ?? {}) as Partial<GroupPrefsSessionMetadata>;
    const groupId = isNonEmptyString(md.groupId) ? md.groupId : "";
    const groupName = isNonEmptyString(md.groupName) ? md.groupName : "";

    const metadata: GroupPrefsSessionMetadata = {
      groupId,
      groupName,
    };

    log.debug("Creating group-prefs session", {
      groupId,
      hasGroupName: groupName.length > 0,
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
    log.debug("Closing group-prefs session", { sessionId: session.id });
  },

  canHandle(session: TerminalSession): boolean {
    return session.terminalType === "group-prefs";
  },
};
