/**
 * ShellPlugin - Default terminal type for standard bash/zsh shells
 *
 * This is the simplest plugin - it creates a tmux session with the user's
 * default shell and renders a standard terminal component.
 */

import { Terminal as TerminalIcon } from "lucide-react";
import type { ReactNode } from "react";
import type {
  TerminalTypePlugin,
  TerminalRenderProps,
  SessionConfig,
  ExitBehavior,
} from "@/types/terminal-type";
import type { TerminalSession, CreateSessionInput } from "@/types/session";

/**
 * Shell plugin configuration
 */
export interface ShellPluginConfig {
  /** Default shell to use (null = user's login shell) */
  defaultShell?: string | null;
  /** Additional shell arguments */
  shellArgs?: string[];
  /** Default environment variables */
  defaultEnv?: Record<string, string>;
}

/**
 * Create a shell plugin instance
 */
export function createShellPlugin(config: ShellPluginConfig = {}): TerminalTypePlugin {
  return {
    type: "shell",
    displayName: "Terminal",
    description: "Standard terminal with your default shell",
    icon: TerminalIcon,
    priority: 100, // High priority - default option
    builtIn: true,

    createSession(
      input: CreateSessionInput,
      _session: Partial<TerminalSession>
    ): SessionConfig {
      return {
        // null = use user's default shell via tmux
        shellCommand: config.defaultShell ?? null,
        shellArgs: config.shellArgs ?? [],
        environment: {
          ...config.defaultEnv,
        },
        cwd: input.projectPath,
        useTmux: true,
      };
    },

    onSessionExit(
      _session: TerminalSession,
      exitCode: number | null
    ): ExitBehavior {
      // For shell sessions, don't show exit screen - just mark as closed
      // User can see the exit in the terminal output
      return {
        showExitScreen: false,
        canRestart: false,
        autoClose: false, // Keep session for viewing output
        exitMessage:
          exitCode === 0
            ? "Shell exited normally"
            : `Shell exited with code ${exitCode}`,
      };
    },

    renderContent(
      session: TerminalSession,
      props: TerminalRenderProps
    ): ReactNode {
      // Import the Terminal component dynamically to avoid SSR issues
      // This will be replaced with actual component in the UI layer
      return {
        type: "terminal",
        session,
        props,
      } as unknown as ReactNode;
    },

    validateInput(input: CreateSessionInput): string | null {
      // Shell sessions just need a name
      if (!input.name?.trim()) {
        return "Session name is required";
      }
      return null;
    },

    canHandle(session: TerminalSession): boolean {
      // Shell plugin handles sessions without agent provider
      // or with agent provider "none"
      return !session.agentProvider || session.agentProvider === "none";
    },
  };
}

/**
 * Default shell plugin instance
 */
export const ShellPlugin = createShellPlugin();
