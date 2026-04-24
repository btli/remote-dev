/**
 * TrashPlugin (server half) — lifecycle for the Trash tab.
 *
 * The trash view is a pure client-side browser over the `trash_item` table;
 * it never spawns a shell, never uses tmux, and has no process to attach to.
 * The lifecycle here is metadata-only. Confirm dialogs (`RestoreDialog`,
 * `DeleteConfirmDialog`) still render as modals owned by the client
 * component — those are short-lived yes/no affordances, not first-class UI.
 *
 * Singleton dedup: callers set `scopeKey: "trash"` on the create-session call
 * so every user gets at most one Trash tab open at a time — re-invoking
 * "Open Trash" jumps to the existing tab instead of spawning a duplicate.
 *
 * @see ./trash-plugin-client.tsx for rendering.
 */

import type {
  TerminalTypeServerPlugin,
  SessionConfig,
  ExitBehavior,
} from "@/types/terminal-type-server";
import type { TerminalSession, CreateSessionInput } from "@/types/session";
import { createLogger } from "@/lib/logger";

const log = createLogger("TrashPlugin.Server");

/**
 * Metadata stored on a trash session.
 *
 * Intentionally empty for now — the trash view is stateless beyond the
 * TrashContext it reads from. Kept as an explicit interface so future
 * additions (e.g. filter state, selection) land in a typed shape.
 */
export interface TrashSessionMetadata {
  /** Reserved for future state (filters, selection). */
  reserved?: never;
}

/** Default trash server plugin instance */
export const TrashServerPlugin: TerminalTypeServerPlugin = {
  type: "trash",
  priority: 50,
  builtIn: true,
  useTmux: false,

  createSession(_input: CreateSessionInput): SessionConfig {
    log.debug("Creating trash session");
    const metadata: TrashSessionMetadata = {};
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
    log.debug("Closing trash session", { sessionId: session.id });
  },

  canHandle(session: TerminalSession): boolean {
    return session.terminalType === "trash";
  },
};
