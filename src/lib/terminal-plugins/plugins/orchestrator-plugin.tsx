/**
 * OrchestratorPlugin - Multi-agent orchestrator terminal type
 *
 * Runs an agent CLI as the shell (like AgentPlugin) but additionally
 * tracks child agent sessions that the orchestrator can spawn.
 */

import { Network } from "lucide-react";
import type { ReactNode } from "react";
import type {
  TerminalTypePlugin,
  TerminalRenderProps,
  SessionConfig,
  ExitBehavior,
  ExitScreenInfo,
  ExitScreenCallbacks,
  OrchestratorSessionMetadata,
} from "@/types/terminal-type";
import type {
  TerminalSession,
  CreateSessionInput,
} from "@/types/session";
import { getProviderConfig, buildAgentCommand } from "../agent-utils";

export const OrchestratorPlugin: TerminalTypePlugin = {
  type: "orchestrator",
  displayName: "Orchestrator",
  description: "Multi-agent orchestrator that can spawn child agents",
  icon: Network,
  priority: 85,
  builtIn: true,

  createSession(input: CreateSessionInput): SessionConfig {
    const providerId = input.agentProvider ?? "claude";
    const provider = getProviderConfig(providerId);

    if (!provider || provider.id === "none") {
      throw new Error(`Invalid agent provider: ${providerId}`);
    }

    const command = buildAgentCommand(provider, input.agentFlags);

    const metadata: OrchestratorSessionMetadata = {
      childSessionIds: [],
      maxChildren: 10,
      autoSpawn: false,
    };

    return {
      shellCommand: command,
      shellArgs: [],
      environment: {
        TERM: "xterm-256color",
      },
      cwd: input.projectPath,
      useTmux: true,
      metadata,
    };
  },

  onSessionExit(
    _session: TerminalSession,
    exitCode: number | null
  ): ExitBehavior {
    return {
      showExitScreen: true,
      canRestart: true,
      autoClose: false,
      exitMessage:
        exitCode === 0
          ? "Orchestrator completed"
          : `Orchestrator exited (code ${exitCode})`,
    };
  },

  onSessionRestart(session: TerminalSession): SessionConfig | null {
    const providerId = session.agentProvider ?? "claude";
    const provider = getProviderConfig(providerId);

    if (!provider || provider.id === "none") {
      return null;
    }

    const agentCommand = buildAgentCommand(provider);

    return {
      shellCommand: agentCommand,
      shellArgs: [],
      environment: {
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

    const providerId = input.agentProvider ?? "claude";
    const provider = getProviderConfig(providerId);

    if (!provider || provider.id === "none") {
      return `Invalid agent provider: ${providerId}`;
    }

    return null;
  },

  canHandle(session: TerminalSession): boolean {
    return session.terminalType === "orchestrator";
  },
};
