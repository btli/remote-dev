/**
 * RestartAgentUseCase - Restarts an agent session with environment preservation.
 *
 * This use case handles restarting agent CLI processes. It leverages tmux's
 * persistent environment - if the tmux session still exists, environment
 * variables persist automatically. If the tmux session needs to be recreated,
 * the environment is re-injected via EnvironmentManager.
 *
 * Flow:
 * 1. Load session from repository
 * 2. Validate it's an agent session
 * 3. Mark as restarting, save
 * 4. Check if tmux session exists
 * 5. If exists, just send the new agent command (env persists)
 * 6. If gone, error - session needs to be recreated via CreateSessionUseCase
 * 7. Mark as running, save
 */

import type { Session } from "@/domain/entities/Session";
import type { SessionRepository } from "@/application/ports/SessionRepository";
import type { TmuxGateway } from "@/application/ports/TmuxGateway";
import {
  type AgentResumeResolver,
  NoopAgentResumeResolver,
} from "@/application/ports/AgentResumeResolver";
import { EntityNotFoundError, InvalidStateTransitionError } from "@/domain/errors/DomainError";
import { AGENT_PROVIDERS, type AgentProviderType } from "@/types/session";
import { buildAgentCommand, quoteShellArg } from "@/lib/terminal-plugins/agent-utils";
import { stripSensitiveEnv } from "@/lib/agent-resume/resume-binding";
import { createLogger } from "@/lib/logger";
import { TmuxEnvironment } from "@/domain/value-objects/TmuxEnvironment";

const log = createLogger("RestartAgent");

export interface RestartAgentInput {
  sessionId: string;
  userId: string;
}

export interface RestartAgentOutput {
  session: Session;
  wasRecreated: boolean;
  /** [hgwo] true when the agent was relaunched with a resume flag/argv. */
  resumed: boolean;
}

export type AgentProviderExecutableResolver = (
  provider: Exclude<AgentProviderType, "none">,
  command: string,
  env?: NodeJS.ProcessEnv,
  cwd?: string,
) => Promise<string | null>;

const rejectUnverifiedGenericProvider: AgentProviderExecutableResolver = async (
  provider,
  command,
) => provider === "cursor" ? null : command;

/**
 * Error thrown when agent restart fails.
 */
export class RestartAgentError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NOT_AGENT_SESSION"
      | "TMUX_SESSION_GONE"
      | "RESTART_FAILED"
      | "INVALID_STATE",
    public readonly sessionId?: string
  ) {
    super(message);
    this.name = "RestartAgentError";
  }
}

export class RestartAgentUseCase {
  constructor(
    private readonly sessionRepository: SessionRepository,
    private readonly tmuxGateway: TmuxGateway,
    // [hgwo] Resume resolver turns the session's stored/discovered native id
    // into resume flags so the conversation comes back, not a fresh agent.
    // Optional + defaults to a no-op resolver so legacy 2-arg construction
    // (and tests) keep the prior fresh-relaunch behavior.
    private readonly resumeResolver: AgentResumeResolver = new NoopAgentResumeResolver(),
    // Production injects the live executable fingerprint check. Legacy
    // callers remain source-compatible, but the default fails closed for the
    // generic Cursor command while allowing provider-specific executable names.
    private readonly resolveProviderExecutable: AgentProviderExecutableResolver = rejectUnverifiedGenericProvider,
  ) {}

  async execute(input: RestartAgentInput): Promise<RestartAgentOutput> {
    // Find the session
    const session = await this.sessionRepository.findById(
      input.sessionId,
      input.userId
    );

    if (!session) {
      throw new EntityNotFoundError("Session", input.sessionId);
    }

    // Validate it's an agent session
    if (
      session.terminalType !== "agent" &&
      session.terminalType !== "loop"
    ) {
      throw new RestartAgentError(
        `Session ${input.sessionId} is not an agent session (type: ${session.terminalType})`,
        "NOT_AGENT_SESSION",
        input.sessionId
      );
    }

    // Validate session state allows restart (must be exited or running)
    const validStates = ["exited", "running"];
    if (session.agentExitState && !validStates.includes(session.agentExitState)) {
      throw new RestartAgentError(
        `Cannot restart agent in state: ${session.agentExitState}`,
        "INVALID_STATE",
        input.sessionId
      );
    }

    // Session must be active (not suspended or closed)
    if (!session.isActive()) {
      throw new InvalidStateTransitionError(
        "restart_agent",
        session.status.toString(),
        ["active"]
      );
    }

    // Mark as restarting
    let restartingSession = session.markAgentRestarting();
    restartingSession = await this.sessionRepository.save(restartingSession);

    // Check if tmux session still exists
    const tmuxName = session.tmuxSessionName.toString();
    const tmuxExists = await this.tmuxGateway.sessionExists(tmuxName);

    if (!tmuxExists) {
      // Tmux session is gone - revert to exited state and throw error
      // The session should be recreated via CreateSessionUseCase
      try {
        const revertedSession = restartingSession.markAgentExited(null);
        await this.sessionRepository.save(revertedSession);
      } catch {
        log.error("Failed to revert session state after tmux gone", { sessionId: input.sessionId });
      }
      throw new RestartAgentError(
        `Tmux session ${tmuxName} no longer exists. Session must be recreated.`,
        "TMUX_SESSION_GONE",
        input.sessionId
      );
    }

    // Tmux session exists - send the new agent command
    // Environment persists at tmux session level, no re-injection needed.
    // [hgwo] Resolve resume flags so the agent's CONVERSATION comes back
    // (was: bare command with no flags). Falls back to a fresh relaunch when
    // the provider has no resume support or no native id is known.
    let resumed = false;
    try {
      const provider =
        AGENT_PROVIDERS.find((p) => p.id === (session.agentProvider ?? "claude")) ??
        AGENT_PROVIDERS.find((p) => p.id === "claude")!;
      if (provider.id === "none") {
        throw new Error("Agent session has no runnable provider");
      }

      const binding = session.typeMetadata?.resumeBinding as
        | { env?: Record<string, string>; executablePath?: string }
        | undefined;
      let tmuxEnv: Record<string, string> = {};
      try {
        tmuxEnv = (await this.tmuxGateway.getEnvironment(tmuxName)).toRecord();
      } catch (error) {
        log.warn("Failed to read tmux environment before agent restart", {
          sessionId: input.sessionId,
          error: String(error),
        });
      }
      const launchEnv: NodeJS.ProcessEnv = {
        ...process.env,
        ...(binding?.env ?? {}),
        ...tmuxEnv,
      };
      const discoveryEnv = Object.fromEntries(
        Object.entries(launchEnv).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
      const executable = await this.resolveProviderExecutable(
        provider.id,
        provider.id === "cursor" && binding?.executablePath
          ? binding.executablePath
          : provider.command,
        launchEnv,
        session.projectPath ?? process.cwd(),
      );
      if (!executable) {
        throw new Error(`Executable '${provider.command}' is not the Cursor Agent CLI`);
      }

      // Re-inject the durable binding's sanitized env into tmux BEFORE
      // relaunch so the agent process inherits the profile-isolated CLI home
      // that holds the resume files — mirrors agent-relaunch.ts (the tmux
      // session may have lost the binding's env after a pod restart).
      const relaunchEnv: Record<string, string> = { ...(binding?.env ?? {}) };
      // A process-level Cursor data-root override participates in discovery
      // even when it was not persisted in the original binding. Mirror it the
      // same way so the resumed CLI reads the same chat index.
      if (
        provider.id === "cursor" &&
        discoveryEnv.CURSOR_DATA_DIR &&
        !relaunchEnv.CURSOR_DATA_DIR
      ) {
        relaunchEnv.CURSOR_DATA_DIR = discoveryEnv.CURSOR_DATA_DIR;
      }
      const safeRelaunchEnv = stripSensitiveEnv(relaunchEnv);
      // Tmux-wins, consistent with discoveryEnv above: when the LIVE tmux
      // session already carries a var, that value is authoritative — a stale
      // resume-binding value must never clobber it (no set-environment, and
      // the command prefix below uses the live value). Only vars tmux lacks
      // are injected (binding value / process-level fill).
      const envToInject: Record<string, string> = {};
      const effectiveRelaunchEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(safeRelaunchEnv)) {
        if (tmuxEnv[key] !== undefined) {
          effectiveRelaunchEnv[key] = tmuxEnv[key];
        } else {
          envToInject[key] = value;
          effectiveRelaunchEnv[key] = value;
        }
      }
      if (Object.keys(envToInject).length > 0) {
        await this.tmuxGateway.setEnvironment(
          tmuxName,
          TmuxEnvironment.create(envToInject),
        );
      }

      const resolution = await this.resumeResolver.resolveResume(session, discoveryEnv);
      resumed = Boolean(resolution);
      const baseAgentCommand = resolution?.argvOverride
        ? resolution.argvOverride.join(" ") // e.g. "codex resume <id>"
        : buildAgentCommand(
            provider,
            resolution?.resumeFlags ?? [],
            false,
            provider.id === "cursor" ? executable : undefined,
          );
      // tmux set-environment only affects future panes/processes; this restart
      // types into a shell that already exists. Prefix the same allowlisted,
      // shell-quoted assignments so the agent process actually inherits them.
      // effectiveRelaunchEnv is tmux-wins: live tmux values where present,
      // binding/process values only for vars tmux lacked (and just injected).
      const envPrefix = Object.entries(effectiveRelaunchEnv)
        .map(([key, value]) => `${key}=${quoteShellArg(value)}`)
        .join(" ");
      const agentCommand = envPrefix
        ? `${envPrefix} ${baseAgentCommand}`
        : baseAgentCommand;
      log.info("Relaunching agent (HTTP restart)", {
        sessionId: input.sessionId,
        provider: provider.id,
        resumed,
      });
      // sendKeys submits with Enter (carriage return) — Claude TUI needs \r.
      await this.tmuxGateway.sendKeys(tmuxName, agentCommand);
    } catch (error) {
      // Revert session to exited state on failure to avoid stuck "restarting" state
      try {
        const revertedSession = restartingSession.markAgentExited(null);
        await this.sessionRepository.save(revertedSession);
      } catch {
        // Log but don't mask original error
        log.error("Failed to revert session state after restart failure", { sessionId: input.sessionId });
      }
      throw new RestartAgentError(
        `Failed to send restart command: ${(error as Error).message}`,
        "RESTART_FAILED",
        input.sessionId
      );
    }

    // Mark as running
    const runningSession = restartingSession.markAgentRunning();
    const savedSession = await this.sessionRepository.save(runningSession);

    return {
      session: savedSession,
      wasRecreated: false,
      resumed,
    };
  }
}
