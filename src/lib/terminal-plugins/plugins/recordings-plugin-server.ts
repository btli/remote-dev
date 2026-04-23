/**
 * RecordingsPlugin (server half) — lifecycle for the recordings browser.
 *
 * Recordings sessions are a pure client-side view over recordings stored in
 * the database: they never spawn a tmux session, never run a shell, and have
 * no process to attach to. The entire lifecycle here is metadata-only.
 *
 * The metadata carries the currently-selected recording id (or null for the
 * list view). C3 will wire a fixed `scopeKey: "recordings"` at the call site
 * so re-opening "Recordings" reuses the single tab per user instead of
 * spawning duplicates.
 *
 * @see ./recordings-plugin-client.tsx for rendering.
 */

import type {
  TerminalTypeServerPlugin,
  SessionConfig,
  ExitBehavior,
} from "@/types/terminal-type-server";
import type { TerminalSession, CreateSessionInput } from "@/types/session";
import { createLogger } from "@/lib/logger";

const log = createLogger("RecordingsPlugin.Server");

/** Recordings session metadata stored with the session */
export interface RecordingsSessionMetadata {
  /** Id of the recording currently open in the player, or null for list view. */
  selectedRecordingId?: string | null;
}

/** Recordings plugin server configuration (currently unused) */
export interface RecordingsPluginServerConfig {
  /** Reserved for future server-side recordings options */
  reserved?: never;
}

/** Create a server-side recordings plugin */
export function createRecordingsServerPlugin(
  _config: RecordingsPluginServerConfig = {}
): TerminalTypeServerPlugin {
  return {
    type: "recordings",
    priority: 70,
    builtIn: true,

    createSession(input: CreateSessionInput): SessionConfig {
      // Read an optional initial selection from the input metadata. Callers
      // (e.g. a "play this recording" entry point) may pre-populate
      // `typeMetadata.selectedRecordingId` — otherwise we start in list mode.
      const seedSelected =
        (input.typeMetadata?.selectedRecordingId as string | null | undefined) ??
        null;

      const metadata: RecordingsSessionMetadata = {
        selectedRecordingId: seedSelected,
      };

      return {
        shellCommand: null,
        shellArgs: [],
        environment: {},
        cwd: input.projectPath,
        // Recordings view never uses tmux — it's a pure data browser.
        useTmux: false,
        // Cast widens to the generic `Record<string, unknown>` branch of
        // the SessionConfig metadata union (the strongly-typed branches
        // only cover built-in metadata shapes like Agent/File/Browser).
        metadata: metadata as unknown as Record<string, unknown>,
      };
    },

    onSessionExit(): ExitBehavior {
      // There is no process to exit; keep the view alive without any screen.
      return {
        showExitScreen: false,
        canRestart: false,
        autoClose: false,
      };
    },

    onSessionClose(session: TerminalSession): void {
      log.debug("Closing recordings session", { sessionId: session.id });
    },

    canHandle(session: TerminalSession): boolean {
      return session.terminalType === "recordings";
    },
  };
}

/** Default recordings server plugin instance */
export const RecordingsServerPlugin = createRecordingsServerPlugin();
