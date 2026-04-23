/**
 * IssuesPlugin (server half) — lifecycle for GitHub issues browser sessions.
 *
 * No tmux, no shell — the issues view is a pure UI pane that proxies the
 * existing `useRepositoryIssues` context + issue components. Server-side work
 * is limited to validating creation input and seeding typeMetadata from the
 * repository the caller wants to browse.
 *
 * Scope key contract: callers should set `scopeKey = repositoryId` so the
 * service reuses an existing open issues tab for that repo instead of
 * creating duplicates.
 *
 * @see ./issues-plugin-client.tsx for rendering.
 */

import type {
  TerminalTypeServerPlugin,
  SessionConfig,
  ExitBehavior,
} from "@/types/terminal-type-server";
import type { TerminalSession, CreateSessionInput } from "@/types/session";
import { createLogger } from "@/lib/logger";

const log = createLogger("IssuesPlugin.Server");

/** Metadata stored on an issues-browser session */
export interface IssuesSessionMetadata {
  /** GitHub repository id (internal DB id — matches github_repository.id) */
  repositoryId: string;
  /** Human-readable repository name (owner/repo) */
  repositoryName: string;
  /** External GitHub URL for the repo (used for "Open in GitHub" affordance) */
  repositoryUrl: string;
  /**
   * Currently-selected issue number (null = list view). Persisted so
   * selection survives reload/tab-switch; updated client-side via the
   * session PATCH endpoint's typeMetadataPatch field.
   */
  selectedIssueNumber: number | null;
}

/** Default issues server plugin instance */
export const IssuesServerPlugin: TerminalTypeServerPlugin = {
  type: "issues",
  priority: 70,
  builtIn: true,

  createSession(input: CreateSessionInput): SessionConfig {
    const md = (input.typeMetadata ?? {}) as Partial<IssuesSessionMetadata>;
    if (!md.repositoryId) {
      throw new Error(
        "issues plugin requires typeMetadata.repositoryId"
      );
    }

    const metadata: IssuesSessionMetadata = {
      repositoryId: md.repositoryId,
      repositoryName: md.repositoryName ?? "",
      repositoryUrl: md.repositoryUrl ?? "",
      selectedIssueNumber:
        typeof md.selectedIssueNumber === "number"
          ? md.selectedIssueNumber
          : null,
    };

    log.debug("Creating issues session", {
      repositoryId: metadata.repositoryId,
      repositoryName: metadata.repositoryName,
      hasInitialSelection: metadata.selectedIssueNumber !== null,
    });

    return {
      shellCommand: null,
      shellArgs: [],
      environment: {},
      cwd: input.projectPath,
      useTmux: false,
      // SessionConfig.metadata is a union of known built-in metadata
      // shapes plus Record<string, unknown>. Issues is a new type that
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
    log.debug("Closing issues session", { sessionId: session.id });
  },

  validateInput(input: CreateSessionInput): string | null {
    const md = (input.typeMetadata ?? {}) as Partial<IssuesSessionMetadata>;
    if (!md.repositoryId) {
      return "repositoryId required for issues sessions";
    }
    return null;
  },

  canHandle(session: TerminalSession): boolean {
    return session.terminalType === "issues";
  },
};
