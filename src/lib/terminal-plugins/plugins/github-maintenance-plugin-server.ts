/**
 * GitHubMaintenancePlugin (server half) — lifecycle for the GitHub
 * maintenance tab (formerly `GitHubMaintenanceModal`).
 *
 * No tmux, no shell — the maintenance view is a pure UI pane that proxies
 * the existing `useGitHubContext` + `useGitHubAccounts` state. Server-side
 * work is limited to validating creation input and seeding `typeMetadata`
 * with the repository the tab is scoped to.
 *
 * Scope key contract: callers set `scopeKey = repositoryId` so the service
 * reuses an existing open maintenance tab for that repo instead of
 * creating duplicates. (One tab per repository.)
 *
 * @see ./github-maintenance-plugin-client.tsx for rendering.
 */

import type {
  TerminalTypeServerPlugin,
  SessionConfig,
  ExitBehavior,
} from "@/types/terminal-type-server";
import type { TerminalSession, CreateSessionInput } from "@/types/session";
import { createLogger } from "@/lib/logger";

const log = createLogger("GitHubMaintenancePlugin.Server");

/** Metadata stored on a GitHub maintenance session. */
export interface GitHubMaintenanceMetadata {
  /** GitHub repository id (internal DB id — matches github_repository.id) */
  repositoryId: string;
  /** Human-readable repository name (owner/repo) */
  repositoryName: string;
  /** External GitHub URL for the repo (used for "Open in GitHub" affordance) */
  repositoryUrl: string;
}

function readMetadata(
  input: CreateSessionInput
): Partial<GitHubMaintenanceMetadata> | undefined {
  return input.typeMetadata as
    | Partial<GitHubMaintenanceMetadata>
    | undefined;
}

/** Default GitHub maintenance server plugin instance. */
export const GitHubMaintenanceServerPlugin: TerminalTypeServerPlugin = {
  type: "github-maintenance",
  priority: 55,
  builtIn: true,
  useTmux: false,

  createSession(input: CreateSessionInput): SessionConfig {
    const md = readMetadata(input);
    if (!md?.repositoryId) {
      throw new Error(
        "github-maintenance plugin requires typeMetadata.repositoryId"
      );
    }

    const metadata: GitHubMaintenanceMetadata = {
      repositoryId: md.repositoryId,
      repositoryName: md.repositoryName ?? "",
      repositoryUrl: md.repositoryUrl ?? "",
    };

    log.debug("Creating github-maintenance session", {
      repositoryId: metadata.repositoryId,
      repositoryName: metadata.repositoryName,
    });

    return {
      shellCommand: null,
      shellArgs: [],
      environment: {},
      cwd: input.projectPath,
      useTmux: false,
      // SessionConfig.metadata is a union of known built-in metadata shapes
      // plus Record<string, unknown>. github-maintenance is a new type that
      // isn't in the union — the Record<string, unknown> branch covers it.
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
    log.debug("Closing github-maintenance session", { sessionId: session.id });
  },

  validateInput(input: CreateSessionInput): string | null {
    const md = readMetadata(input);
    if (!md?.repositoryId?.trim()) {
      return "repositoryId required for github-maintenance sessions";
    }
    return null;
  },

  canHandle(session: TerminalSession): boolean {
    return session.terminalType === "github-maintenance";
  },
};
