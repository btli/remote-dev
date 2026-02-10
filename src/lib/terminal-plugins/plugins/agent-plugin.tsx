/**
 * AgentPlugin - AI agent terminal type where agent runs as the shell
 *
 * Key features:
 * - Agent command runs as the tmux shell (not launched after shell starts)
 * - When agent exits, shows exit screen with restart/delete options
 * - Supports multiple agent providers (Claude, Codex, Gemini, OpenCode)
 */

import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type {
  TerminalTypePlugin,
  TerminalRenderProps,
  SessionConfig,
  ExitBehavior,
  ExitScreenInfo,
  ExitScreenCallbacks,
  AgentSessionMetadata,
} from "@/types/terminal-type";
import type {
  TerminalSession,
  CreateSessionInput,
  AgentProviderType,
  AgentProviderConfig,
} from "@/types/session";
import { AGENT_PROVIDERS } from "@/types/session";

/**
 * Agent plugin configuration
 */
export interface AgentPluginConfig {
  /** Default agent provider */
  defaultProvider?: AgentProviderType;
  /** Additional environment variables for all agents */
  defaultEnv?: Record<string, string>;
  /** Allow dangerous flags (--dangerously-skip-permissions, etc.) */
  allowDangerousFlags?: boolean;
}

/**
 * Build the agent command string
 */
function buildAgentCommand(
  provider: AgentProviderConfig,
  flags: string[] = [],
  allowDangerous = false
): string {
  const safeFlags = allowDangerous
    ? flags
    : flags.filter((f) => !provider.dangerousFlags?.includes(f));

  const allFlags = [...provider.defaultFlags, ...safeFlags];
  const flagsStr = allFlags.length > 0 ? ` ${allFlags.join(" ")}` : "";

  return `${provider.command}${flagsStr}`;
}

/**
 * Get agent provider config by ID
 */
function getProviderConfig(
  providerId: AgentProviderType
): AgentProviderConfig | undefined {
  return AGENT_PROVIDERS.find((p) => p.id === providerId);
}

/**
 * Create an agent plugin instance
 */
export function createAgentPlugin(
  config: AgentPluginConfig = {}
): TerminalTypePlugin {
  return {
    type: "agent",
    displayName: "AI Agent",
    description: "AI coding assistant (Claude, Codex, Gemini, etc.)",
    icon: Sparkles,
    priority: 90, // Second highest priority
    builtIn: true,

    createSession(input: CreateSessionInput): SessionConfig {
      const providerId = input.agentProvider ?? config.defaultProvider ?? "claude";
      const provider = getProviderConfig(providerId);

      if (!provider || provider.id === "none") {
        throw new Error(`Invalid agent provider: ${providerId}`);
      }

      // Build the agent command that will run as the shell
      const agentCommand = buildAgentCommand(
        provider,
        input.agentFlags,
        config.allowDangerousFlags
      );

      // Create metadata to store with session
      const metadata: AgentSessionMetadata = {
        agentProvider: providerId,
        exitState: "running",
        exitCode: null,
        exitedAt: null,
        restartCount: 0,
        lastStartedAt: new Date(),
      };

      return {
        // IMPORTANT: Agent command IS the shell command
        // When this exits, the tmux session process exits
        shellCommand: agentCommand,
        shellArgs: [],
        environment: {
          ...config.defaultEnv,
          // Set TERM to ensure good terminal support
          TERM: "xterm-256color",
        },
        cwd: input.projectPath,
        useTmux: true,
        metadata,
      };
    },

    onSessionExit(
      session: TerminalSession,
      exitCode: number | null
    ): ExitBehavior {
      // Agent sessions show exit screen so user can restart
      return {
        showExitScreen: true,
        canRestart: true,
        autoClose: false,
        exitMessage: this.getExitMessage(session, exitCode),
      };
    },

    onSessionRestart(session: TerminalSession): SessionConfig | null {
      const providerId = session.agentProvider ?? "claude";
      const provider = getProviderConfig(providerId);

      if (!provider || provider.id === "none") {
        return null; // Cannot restart without valid provider
      }

      const agentCommand = buildAgentCommand(
        provider,
        [], // Reset to default flags on restart
        config.allowDangerousFlags
      );

      return {
        shellCommand: agentCommand,
        shellArgs: [],
        environment: {
          ...config.defaultEnv,
          TERM: "xterm-256color",
        },
        cwd: session.projectPath ?? undefined,
        useTmux: true,
      };
    },

    renderContent(
      session: TerminalSession,
      props: TerminalRenderProps
    ): ReactNode {
      // Return a marker that the UI layer will interpret
      // The actual Terminal component is rendered by TerminalTypeRenderer
      return {
        type: "terminal",
        session,
        props,
      } as unknown as ReactNode;
    },

    renderExitScreen(
      session: TerminalSession,
      exitInfo: ExitScreenInfo,
      callbacks: ExitScreenCallbacks
    ): ReactNode {
      // Return a marker that the UI layer will interpret
      // The actual AgentExitScreen component is rendered by TerminalTypeRenderer
      return {
        type: "agent-exit-screen",
        session,
        exitInfo,
        callbacks,
      } as unknown as ReactNode;
    },

    validateInput(input: CreateSessionInput): string | null {
      if (!input.name?.trim()) {
        return "Session name is required";
      }

      const providerId = input.agentProvider ?? config.defaultProvider ?? "claude";
      const provider = getProviderConfig(providerId);

      if (!provider || provider.id === "none") {
        return `Invalid agent provider: ${providerId}`;
      }

      return null;
    },

    canHandle(session: TerminalSession): boolean {
      // Agent plugin handles sessions with an agent provider (not "none")
      return Boolean(session.agentProvider && session.agentProvider !== "none");
    },

    // Helper method for exit message
    getExitMessage(session: TerminalSession, exitCode: number | null): string {
      const provider = getProviderConfig(session.agentProvider ?? "claude");
      const agentName = provider?.name ?? "Agent";

      if (exitCode === 0) {
        return `${agentName} completed successfully`;
      } else if (exitCode === null) {
        return `${agentName} was terminated`;
      } else if (exitCode === 130) {
        return `${agentName} was interrupted (Ctrl+C)`;
      } else if (exitCode === 137) {
        return `${agentName} was killed (out of memory?)`;
      } else {
        return `${agentName} exited with code ${exitCode}`;
      }
    },
  } as TerminalTypePlugin & { getExitMessage: (session: TerminalSession, exitCode: number | null) => string };
}

/**
 * Default agent plugin instance
 */
export const AgentPlugin = createAgentPlugin();
