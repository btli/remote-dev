/**
 * AgentPlugin (server half) — lifecycle for AI agent sessions (Claude, Codex,
 * Gemini, OpenCode). The agent command runs as the tmux shell so the session
 * exits when the agent exits, triggering the exit screen on the client.
 *
 * @see ./agent-plugin-client.tsx for rendering.
 */

import type {
  TerminalTypeServerPlugin,
  SessionConfig,
  ExitBehavior,
  AgentSessionMetadata,
} from "@/types/terminal-type-server";
import type {
  TerminalSession,
  CreateSessionInput,
  AgentProviderType,
} from "@/types/session";
import { getProviderConfig, buildAgentCommand } from "../agent-utils";

/**
 * Resolve the agent command, honoring a caller-supplied startup command
 * wrapper when present. Matches the service-level `buildAgentCommand`
 * semantics in SessionService: a single-word override (e.g. `jclaude`) is
 * swapped in for the provider's default command name and combined with the
 * provider's default flags + caller-supplied flags. Overrides containing
 * spaces are treated as complete commands and used as-is to avoid
 * double-appending flags.
 */
function resolveAgentCommand(
  provider: ReturnType<typeof getProviderConfig>,
  flags: string[] | undefined,
  allowDangerous: boolean | undefined,
  override: string | undefined
): string {
  if (!provider) throw new Error("Agent provider is undefined");
  if (override) {
    if (override.includes(" ")) return override;
    const baseCommand = override;
    const safeFlags = allowDangerous
      ? flags ?? []
      : (flags ?? []).filter(
          (f) => !provider.dangerousFlags?.includes(f)
        );
    const allFlags = [...provider.defaultFlags, ...safeFlags];
    const flagsStr = allFlags.length > 0 ? ` ${allFlags.join(" ")}` : "";
    return `${baseCommand}${flagsStr}`;
  }
  return buildAgentCommand(provider, flags, allowDangerous);
}

/** Agent plugin configuration */
export interface AgentPluginServerConfig {
  /** Default agent provider */
  defaultProvider?: AgentProviderType;
  /** Additional environment variables for all agents */
  defaultEnv?: Record<string, string>;
  /** Allow dangerous flags (--dangerously-skip-permissions, etc.) */
  allowDangerousFlags?: boolean;
}

function buildExitMessage(
  session: TerminalSession,
  exitCode: number | null
): string {
  const provider = getProviderConfig(session.agentProvider ?? "claude");
  const agentName = provider?.name ?? "Agent";

  if (exitCode === 0) return `${agentName} completed successfully`;
  if (exitCode === null) return `${agentName} was terminated`;
  if (exitCode === 130) return `${agentName} was interrupted (Ctrl+C)`;
  if (exitCode === 137) return `${agentName} was killed (out of memory?)`;
  return `${agentName} exited with code ${exitCode}`;
}

/** Create a server-side agent plugin */
export function createAgentServerPlugin(
  config: AgentPluginServerConfig = {}
): TerminalTypeServerPlugin {
  return {
    type: "agent",
    priority: 90,
    builtIn: true,

    createSession(input: CreateSessionInput): SessionConfig {
      const providerId =
        input.agentProvider ?? config.defaultProvider ?? "claude";
      const provider = getProviderConfig(providerId);

      if (!provider || provider.id === "none") {
        throw new Error(`Invalid agent provider: ${providerId}`);
      }

      // Honor folder/profile-resolved wrapper (e.g. `jclaude`) when present.
      // Precedence documented on TerminalTypeServerPlugin.createSession.
      const agentCommand = resolveAgentCommand(
        provider,
        input.agentFlags,
        config.allowDangerousFlags,
        input.startupCommandOverride
      );

      const metadata: AgentSessionMetadata = {
        agentProvider: providerId,
        exitState: "running",
        exitCode: null,
        exitedAt: null,
        restartCount: 0,
        lastStartedAt: new Date(),
      };

      return {
        // Agent command IS the shell command — when it exits, the tmux
        // session process exits, which surfaces the exit screen client-side.
        shellCommand: agentCommand,
        shellArgs: [],
        environment: {
          ...config.defaultEnv,
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
      return {
        showExitScreen: true,
        canRestart: true,
        autoClose: false,
        exitMessage: buildExitMessage(session, exitCode),
      };
    },

    onSessionRestart(session: TerminalSession): SessionConfig | null {
      const providerId = session.agentProvider ?? "claude";
      const provider = getProviderConfig(providerId);

      if (!provider || provider.id === "none") return null;

      const agentCommand = buildAgentCommand(
        provider,
        [],
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

    validateInput(input: CreateSessionInput): string | null {
      if (!input.name?.trim()) {
        return "Session name is required";
      }
      const providerId =
        input.agentProvider ?? config.defaultProvider ?? "claude";
      const provider = getProviderConfig(providerId);
      if (!provider || provider.id === "none") {
        return `Invalid agent provider: ${providerId}`;
      }
      return null;
    },

    canHandle(session: TerminalSession): boolean {
      return Boolean(
        session.agentProvider && session.agentProvider !== "none"
      );
    },
  };
}

/** Default agent server plugin instance */
export const AgentServerPlugin = createAgentServerPlugin();
