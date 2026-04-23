/**
 * PRsPlugin (server half) — lifecycle for GitHub Pull Requests browser
 * sessions. No tmux, no shell command — metadata only.
 *
 * @see ./prs-plugin-client.tsx for rendering.
 */

import type {
  TerminalTypeServerPlugin,
  SessionConfig,
  ExitBehavior,
} from "@/types/terminal-type-server";
import type { TerminalSession, CreateSessionInput } from "@/types/session";
import { createLogger } from "@/lib/logger";

const log = createLogger("PRsPlugin.Server");

/**
 * Metadata stored with a PRs browser session.
 *
 * `repositoryId`, `repositoryName`, and `repositoryUrl` are seeded at
 * creation time from the user's input. `selectedPrNumber` is persisted as
 * the user navigates between list and detail views so the selection
 * survives reconnects.
 */
export interface PRsSessionMetadata {
  repositoryId: string;
  repositoryName: string;
  repositoryUrl: string;
  /** PR number currently in focus (detail view), or null for list view. */
  selectedPrNumber?: number | null;
}

function readMetadata(
  input: CreateSessionInput
): Partial<PRsSessionMetadata> | undefined {
  const md = input.typeMetadata as
    | Partial<PRsSessionMetadata>
    | undefined;
  return md;
}

/** Default PRs server plugin instance */
export const PRsServerPlugin: TerminalTypeServerPlugin = {
  type: "prs",
  priority: 70,
  builtIn: true,
  useTmux: false,

  createSession(input: CreateSessionInput): SessionConfig {
    const md = readMetadata(input);

    if (!md?.repositoryId) {
      throw new Error(
        "repositoryId is required to create a PRs browser session"
      );
    }

    const metadata: PRsSessionMetadata = {
      repositoryId: md.repositoryId,
      repositoryName: md.repositoryName ?? "",
      repositoryUrl: md.repositoryUrl ?? "",
      selectedPrNumber:
        typeof md.selectedPrNumber === "number" ? md.selectedPrNumber : null,
    };

    return {
      shellCommand: null,
      shellArgs: [],
      environment: {},
      // PRs browser never uses tmux
      useTmux: false,
      // F8: Cast widens to the generic `Record<string, unknown>` branch of
      // the SessionConfig metadata union for consistency with the other
      // new plugins (recordings/settings/profiles). The union's named
      // branches only cover built-in metadata shapes.
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
    log.debug("Closing PRs session", { sessionId: session.id });
  },

  validateInput(input: CreateSessionInput): string | null {
    if (!input.name?.trim()) {
      return "Session name is required";
    }
    const md = readMetadata(input);
    if (!md?.repositoryId?.trim()) {
      return "repositoryId is required for PRs browser sessions";
    }
    return null;
  },

  canHandle(session: TerminalSession): boolean {
    return session.terminalType === "prs";
  },
};
