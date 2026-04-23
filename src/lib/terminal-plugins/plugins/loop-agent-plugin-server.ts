/**
 * LoopAgentPlugin (server half) — lifecycle for chat-first agent sessions
 * with optional loop scheduling. Shares the tmux/PTY infrastructure with
 * the regular agent plugin; the client renders a chat UI instead of xterm.
 *
 * @see ./loop-agent-plugin-client.tsx for rendering.
 */

import type {
  TerminalTypeServerPlugin,
  SessionConfig,
  ExitBehavior,
} from "@/types/terminal-type-server";
import type {
  TerminalSession,
  CreateSessionInput,
} from "@/types/session";
import type { LoopAgentMetadata, LoopConfig } from "@/types/loop-agent";
import { getProviderConfig, buildAgentCommand } from "../agent-utils";

/** Create a server-side loop agent plugin */
export function createLoopAgentServerPlugin(): TerminalTypeServerPlugin {
  return {
    type: "loop",
    priority: 85,
    builtIn: true,

    createSession(input: CreateSessionInput): SessionConfig {
      const providerId = input.agentProvider ?? "claude";
      const provider = getProviderConfig(providerId);

      if (!provider || provider.id === "none") {
        throw new Error(`Invalid agent provider: ${providerId}`);
      }

      // For Claude, force stream-json output so the loop parser can
      // reconstruct structured chat messages from the PTY byte stream.
      const flags = [...(input.agentFlags ?? [])];
      if (providerId === "claude" && !flags.includes("--output-format")) {
        flags.push("--output-format", "stream-json");
      }

      // Honor folder/profile-resolved wrapper (e.g. `jclaude`) when present.
      // Precedence documented on TerminalTypeServerPlugin.createSession.
      const override = input.startupCommandOverride;
      let agentCommand: string;
      if (override) {
        if (override.includes(" ")) {
          agentCommand = override;
        } else {
          const allFlags = [...provider.defaultFlags, ...flags];
          const flagsStr = allFlags.length > 0 ? ` ${allFlags.join(" ")}` : "";
          agentCommand = `${override}${flagsStr}`;
        }
      } else {
        agentCommand = buildAgentCommand(provider, flags, false);
      }

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
      if (!provider || provider.id === "none") return null;

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

/** Default loop agent server plugin instance */
export const LoopAgentServerPlugin = createLoopAgentServerPlugin();
