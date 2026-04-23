/**
 * ShellPlugin (server half) — lifecycle for standard bash/zsh shell sessions.
 *
 * No React, no Lucide — safe to import from `session-service.ts`.
 *
 * @see ./shell-plugin-client.tsx for the rendering half.
 */

import type {
  TerminalTypeServerPlugin,
  SessionConfig,
  ExitBehavior,
} from "@/types/terminal-type-server";
import type { TerminalSession, CreateSessionInput } from "@/types/session";

/** Shell plugin configuration */
export interface ShellPluginServerConfig {
  /** Default shell to use (null = user's login shell) */
  defaultShell?: string | null;
  /** Additional shell arguments */
  shellArgs?: string[];
  /** Default environment variables */
  defaultEnv?: Record<string, string>;
}

/** Create a server-side shell plugin */
export function createShellServerPlugin(
  config: ShellPluginServerConfig = {}
): TerminalTypeServerPlugin {
  return {
    type: "shell",
    priority: 100,
    builtIn: true,

    createSession(input: CreateSessionInput): SessionConfig {
      return {
        // null = use user's default shell via tmux
        shellCommand: config.defaultShell ?? null,
        shellArgs: config.shellArgs ?? [],
        environment: { ...config.defaultEnv },
        cwd: input.projectPath,
        useTmux: true,
      };
    },

    onSessionExit(
      _session: TerminalSession,
      exitCode: number | null
    ): ExitBehavior {
      return {
        showExitScreen: false,
        canRestart: false,
        autoClose: false, // keep session for viewing output
        exitMessage:
          exitCode === 0
            ? "Shell exited normally"
            : `Shell exited with code ${exitCode}`,
      };
    },

    validateInput(input: CreateSessionInput): string | null {
      if (!input.name?.trim()) {
        return "Session name is required";
      }
      return null;
    },

    canHandle(session: TerminalSession): boolean {
      return !session.agentProvider || session.agentProvider === "none";
    },
  };
}

/** Default shell server plugin instance */
export const ShellServerPlugin = createShellServerPlugin();
