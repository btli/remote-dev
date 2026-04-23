/**
 * SettingsPlugin (server half) — lifecycle for the application Settings pane.
 *
 * The settings pane is a pure UI session: no tmux, no shell, no PTY. The
 * server plugin only seeds `typeMetadata` with the optional initially-active
 * tab so the client can restore it when it mounts.
 *
 * Singleton dedup: C5 (wave 2b) will set `scopeKey: "settings"` on the
 * create-session call so every user gets at most one Settings session open
 * at a time — re-invoking "Open Settings" jumps to the existing tab instead
 * of spawning a duplicate.
 *
 * @see ./settings-plugin-client.tsx for rendering.
 */

import type {
  TerminalTypeServerPlugin,
  SessionConfig,
  ExitBehavior,
} from "@/types/terminal-type-server";
import type { TerminalSession, CreateSessionInput } from "@/types/session";
import { createLogger } from "@/lib/logger";

const log = createLogger("SettingsPlugin.Server");

/**
 * Metadata stored on a settings session.
 *
 * `activeTab` is the nav section the Settings view should open to (e.g.
 * `"terminal"`, `"appearance"`, `"logs"`). Stored as an opaque string so
 * the server half never has to import the `SettingsSection` union from
 * the client-only `SettingsView` component. `null` means "use the
 * default section" (currently "terminal").
 */
export interface SettingsSessionMetadata {
  activeTab?: string | null;
}

/** Default settings server plugin instance */
export const SettingsServerPlugin: TerminalTypeServerPlugin = {
  type: "settings",
  priority: 60,
  builtIn: true,

  createSession(input: CreateSessionInput): SessionConfig {
    const md = (input.typeMetadata ?? {}) as Partial<SettingsSessionMetadata>;
    const metadata: SettingsSessionMetadata = {
      activeTab: md.activeTab ?? null,
    };

    log.debug("Creating settings session", {
      hasInitialTab: metadata.activeTab !== null,
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
    log.debug("Closing settings session", { sessionId: session.id });
  },

  canHandle(session: TerminalSession): boolean {
    return session.terminalType === "settings";
  },
};
