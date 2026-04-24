/**
 * PortManagerPlugin (server half) — lifecycle for the Port Manager pane.
 *
 * The Port Manager is a pure UI session: no tmux, no shell, no PTY. It owns
 * only the `typeMetadata` that tracks which sub-tab (Allocations / Frameworks)
 * the user was last viewing so the state survives reloads.
 *
 * Singleton dedup: the open-site in SessionManager sets
 * `scopeKey: "port-manager"` so re-opening "Ports" jumps to the single
 * existing tab instead of spawning a duplicate.
 *
 * @see ./port-manager-plugin-client.tsx for rendering.
 */

import type {
  TerminalTypeServerPlugin,
  SessionConfig,
  ExitBehavior,
} from "@/types/terminal-type-server";
import type { TerminalSession, CreateSessionInput } from "@/types/session";
import { createLogger } from "@/lib/logger";

const log = createLogger("PortManagerPlugin.Server");

/** Sub-tabs rendered inside the Port Manager view. */
export type PortManagerActiveTab = "allocations" | "frameworks";

/**
 * Metadata persisted with a Port Manager session. `activeTab === null`
 * (or missing) means the client should fall back to its default tab
 * (`"allocations"`).
 */
export interface PortManagerMetadata {
  activeTab?: PortManagerActiveTab | null;
}

const VALID_TABS: ReadonlySet<PortManagerActiveTab> = new Set([
  "allocations",
  "frameworks",
]);

function isValidTab(value: unknown): value is PortManagerActiveTab {
  return typeof value === "string" && VALID_TABS.has(value as PortManagerActiveTab);
}

/** Default port-manager server plugin instance */
export const PortManagerServerPlugin: TerminalTypeServerPlugin = {
  type: "port-manager",
  priority: 55,
  builtIn: true,
  useTmux: false,

  createSession(input: CreateSessionInput): SessionConfig {
    const incoming = (input.typeMetadata ?? {}) as PortManagerMetadata;
    const metadata: PortManagerMetadata = {
      activeTab: isValidTab(incoming.activeTab) ? incoming.activeTab : null,
    };

    log.debug("Creating port-manager session", {
      hasInitialTab: metadata.activeTab !== null,
    });

    return {
      shellCommand: null,
      shellArgs: [],
      environment: {},
      useTmux: false,
      // Cast widens to the generic `Record<string, unknown>` branch of the
      // SessionConfig metadata union.
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
    log.debug("Closing port-manager session", { sessionId: session.id });
  },

  canHandle(session: TerminalSession): boolean {
    return session.terminalType === "port-manager";
  },
};
