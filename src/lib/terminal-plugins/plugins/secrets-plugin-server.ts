/**
 * SecretsPlugin (server half) — lifecycle for the per-project Secrets
 * configuration pane.
 *
 * The Secrets pane is a pure UI session: no tmux, no shell, no PTY. Each
 * session is scoped to a single project — the `projectId` and `projectName`
 * live on `typeMetadata` so the client can render the correct view after a
 * reload without re-fetching the whole project tree.
 *
 * Singleton dedup per project: `scopeKey` is set by the caller to the target
 * project's id (see SessionManager.openSecretsSession), so opening Secrets
 * for the same project twice reuses the existing tab.
 *
 * @see ./secrets-plugin-client.tsx for rendering.
 */

import type {
  TerminalTypeServerPlugin,
  SessionConfig,
  ExitBehavior,
} from "@/types/terminal-type-server";
import type { TerminalSession, CreateSessionInput } from "@/types/session";
import { createLogger } from "@/lib/logger";

const log = createLogger("SecretsPlugin.Server");

/**
 * Metadata stored on a Secrets session. The `projectName` is a cached
 * snapshot so the tab title renders correctly even before the project tree
 * has loaded on reconnect.
 */
export interface SecretsSessionMetadata {
  projectId: string;
  projectName: string;
}

function isSecretsMetadata(value: unknown): value is SecretsSessionMetadata {
  if (value == null || typeof value !== "object") return false;
  const md = value as Record<string, unknown>;
  return typeof md.projectId === "string" && typeof md.projectName === "string";
}

/** Default secrets server plugin instance */
export const SecretsServerPlugin: TerminalTypeServerPlugin = {
  type: "secrets",
  priority: 62,
  builtIn: true,
  useTmux: false,

  validateInput(input: CreateSessionInput): string | null {
    const md = input.typeMetadata;
    if (!md || typeof md !== "object") {
      return "Secrets session requires typeMetadata with projectId and projectName";
    }
    const projectId = (md as Record<string, unknown>).projectId;
    const projectName = (md as Record<string, unknown>).projectName;
    if (typeof projectId !== "string" || projectId.length === 0) {
      return "Secrets session requires a non-empty projectId in typeMetadata";
    }
    if (typeof projectName !== "string") {
      return "Secrets session requires a projectName in typeMetadata";
    }
    return null;
  },

  createSession(input: CreateSessionInput): SessionConfig {
    const md = (input.typeMetadata ?? {}) as Partial<SecretsSessionMetadata>;
    const metadata: SecretsSessionMetadata = {
      projectId: String(md.projectId ?? ""),
      projectName: String(md.projectName ?? ""),
    };

    log.debug("Creating secrets session", { projectId: metadata.projectId });

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
    log.debug("Closing secrets session", { sessionId: session.id });
  },

  canHandle(session: TerminalSession): boolean {
    return session.terminalType === "secrets";
  },
};

export { isSecretsMetadata };
