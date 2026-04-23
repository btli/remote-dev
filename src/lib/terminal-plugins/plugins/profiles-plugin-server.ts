/**
 * ProfilesPlugin (server half) — lifecycle for the agent-profile manager
 * rendered as a terminal tab. No tmux, no shell command — this plugin just
 * owns the `typeMetadata` that tracks which profile / sub-tab the user is
 * currently viewing so the state survives reloads.
 *
 * @see ./profiles-plugin-client.tsx for rendering.
 */

import type {
  TerminalTypeServerPlugin,
  SessionConfig,
  ExitBehavior,
} from "@/types/terminal-type-server";
import type { TerminalSession, CreateSessionInput } from "@/types/session";
import { createLogger } from "@/lib/logger";

const log = createLogger("ProfilesPlugin.Server");

/** Sub-tabs rendered inside the Profiles config view. */
export type ProfilesActiveTab = "general" | "config" | "git" | "secrets" | "mcp";

/**
 * Metadata persisted with a Profiles session.
 *
 * `activeProfileId === null | undefined` means the list view is shown.
 * When set, the config view for that profile is shown, with `activeTab`
 * selected (default: `"general"`).
 */
export interface ProfilesSessionMetadata {
  activeProfileId?: string | null;
  activeTab?: ProfilesActiveTab | null;
}

const VALID_TABS: ReadonlySet<ProfilesActiveTab> = new Set([
  "general",
  "config",
  "git",
  "secrets",
  "mcp",
]);

function isValidTab(value: unknown): value is ProfilesActiveTab {
  return typeof value === "string" && VALID_TABS.has(value as ProfilesActiveTab);
}

/** Default profiles server plugin instance */
export const ProfilesServerPlugin: TerminalTypeServerPlugin = {
  type: "profiles",
  priority: 80,
  builtIn: true,
  useTmux: false,

  createSession(input: CreateSessionInput): SessionConfig {
    const incoming = (input.typeMetadata ?? {}) as ProfilesSessionMetadata;

    const activeProfileId =
      typeof incoming.activeProfileId === "string" ? incoming.activeProfileId : null;
    const activeTab = isValidTab(incoming.activeTab) ? incoming.activeTab : null;

    const metadata: ProfilesSessionMetadata = {
      activeProfileId,
      activeTab,
    };

    return {
      shellCommand: null,
      shellArgs: [],
      environment: {},
      // Profiles never uses tmux — it's a pure React surface.
      useTmux: false,
      // `SessionConfig.metadata` accepts a generic `Record<string, unknown>`
      // alongside the per-plugin named shapes; cast through it so the typed
      // `ProfilesSessionMetadata` survives while satisfying the union.
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
    log.debug("Closing profiles session", { sessionId: session.id });
  },

  canHandle(session: TerminalSession): boolean {
    return session.terminalType === "profiles";
  },
};
