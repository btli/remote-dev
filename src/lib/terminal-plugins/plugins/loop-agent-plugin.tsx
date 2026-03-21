/**
 * LoopAgentPlugin — Chat-first agent terminal type with loop scheduling
 *
 * Renders a conversational chat UI instead of raw xterm.js terminal.
 * The agent still runs in tmux via PTY (reusing all existing agent infrastructure),
 * but output is parsed into structured messages displayed as chat bubbles.
 *
 * Supports two modes:
 * - "conversational": Long-running agent chat with anytime user interrupts
 * - "monitoring": Recurring prompt fired on an interval
 */

import { MessageCircle } from "lucide-react";
import type { ReactNode } from "react";
import type {
  TerminalTypePlugin,
  TerminalRenderProps,
  SessionConfig,
  ExitBehavior,
} from "@/types/terminal-type";
import type {
  TerminalSession,
  CreateSessionInput,
} from "@/types/session";
import type { LoopAgentMetadata, LoopConfig } from "@/types/loop-agent";
import { getProviderConfig, buildAgentCommand } from "../agent-utils";

/**
 * Create a loop agent plugin instance
 */
export function createLoopAgentPlugin(): TerminalTypePlugin {
  return {
    type: "loop",
    displayName: "Loop Agent",
    description: "Chat-first AI agent with loop scheduling",
    icon: MessageCircle,
    priority: 85, // Between agent (90) and browser
    builtIn: true,

    createSession(input: CreateSessionInput): SessionConfig {
      const providerId = input.agentProvider ?? "claude";
      const provider = getProviderConfig(providerId);

      if (!provider || provider.id === "none") {
        throw new Error(`Invalid agent provider: ${providerId}`);
      }

      // Build agent command — add stream-json output for Claude
      const flags = [...(input.agentFlags ?? [])];
      if (providerId === "claude" && !flags.includes("--output-format")) {
        flags.push("--output-format", "stream-json");
      }

      const agentCommand = buildAgentCommand(provider, flags, false);

      // Parse loop config from input metadata or defaults
      const loopConfig: LoopConfig = {
        loopType: "conversational",
        autoRestart: false,
        ...input.loopConfig,
      };

      const metadata: LoopAgentMetadata = {
        agentProvider: providerId,
        loopConfig,
        currentIteration: 0,
        terminalVisible: false,
      };

      return {
        shellCommand: agentCommand,
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
      session: TerminalSession,
      exitCode: number | null
    ): ExitBehavior {
      const metadata = session.typeMetadata as LoopAgentMetadata | null;
      const isMonitoring = metadata?.loopConfig.loopType === "monitoring";

      let exitMessage: string;
      if (exitCode !== 0) {
        exitMessage = `Agent exited with code ${exitCode ?? "unknown"}`;
      } else if (isMonitoring) {
        exitMessage = "Loop completed";
      } else {
        exitMessage = "Agent completed";
      }

      return {
        showExitScreen: true,
        canRestart: true,
        autoClose: false,
        exitMessage,
      };
    },

    onSessionRestart(session: TerminalSession): SessionConfig | null {
      const providerId = session.agentProvider ?? "claude";
      const provider = getProviderConfig(providerId);

      if (!provider || provider.id === "none") {
        return null;
      }

      const flags: string[] = [];
      if (providerId === "claude") {
        flags.push("--output-format", "stream-json");
      }

      const agentCommand = buildAgentCommand(provider, flags, false);

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
      // Return a marker for TerminalTypeRenderer/SessionManager to interpret
      return {
        type: "loop-chat",
        session,
        props,
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
      return session.terminalType === "loop";
    },
  };
}

/**
 * Default loop agent plugin instance
 */
export const LoopAgentPlugin = createLoopAgentPlugin();
