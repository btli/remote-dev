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

    // Claim the next generation with a DB compare-and-set. REST and WS restart
    // requests can arrive concurrently from different processes; exactly one
    // may kill/replace the pane.
    const restartingSession = await this.sessionRepository.claimAgentRestart(
      input.sessionId,
      input.userId,
      session.agentRestartCount,
    );
    if (!restartingSession) {
      throw new RestartAgentError(
        "Another restart or lifecycle transition already won",
        "INVALID_STATE",
        input.sessionId,
      );
    }
    const generation = restartingSession.agentRestartCount;

    // Probe without conflating a timeout/permission/daemon error with absence.
    // If the probe is ambiguous, quarantine the possibly-live old process
    // before changing the generation to an exited state.
    const tmuxName = session.tmuxSessionName.toString();
    const tmuxPresence = await this.tmuxGateway.getSessionPresence(tmuxName);
    let confirmedAbsent = tmuxPresence === "absent";
    if (tmuxPresence === "unknown") {
      confirmedAbsent = await this.tmuxGateway.stopSessionAndConfirmAbsent(tmuxName);
    }

    if (tmuxPresence !== "present") {
      if (confirmedAbsent) {
        // The session is definitely gone (or was strictly contained), so the
        // claimed generation can safely become exited and be recreated.
        try {
          await this.sessionRepository.failAgentRestart(
            input.sessionId,
            input.userId,
            generation,
          );
        } catch {
          log.error("Failed to revert session state after tmux gone", {
            sessionId: input.sessionId,
          });
        }
        throw new RestartAgentError(
          `Tmux session ${tmuxName} no longer exists. Session must be recreated.`,
          "TMUX_SESSION_GONE",
          input.sessionId,
        );
      }

      // Leave the generation restarting: liveness includes that state and can
      // retry containment after the transient tmux failure clears.
      log.error("Retaining restart claim after uncertain tmux preflight", {
        sessionId: input.sessionId,
        generation,
      });
      throw new RestartAgentError(
        `Unable to confirm or contain tmux session ${tmuxName}`,
        "RESTART_FAILED",
        input.sessionId,
      );
    }

    // Tmux session exists - send the new agent command
    // Environment persists at tmux session level, no re-injection needed.
    // [hgwo] Resolve resume flags so the agent's CONVERSATION comes back
    // (was: bare command with no flags). Falls back to a fresh relaunch when
    // the provider has no resume support or no native id is known.
    let resumed = false;
    let runningSession: Session | null = null;
    try {
      // Update generation before killing/respawning the old pane. Its installed
      // hook still carries the previous generation and is therefore ignored;
      // the gateway installs a new hook after respawn and before launch.
      await this.tmuxGateway.setEnvironment(
        tmuxName,
        TmuxEnvironment.create({
          RDV_AGENT_GENERATION: String(restartingSession.agentRestartCount),
          RDV_AGENT_PROVIDER: session.agentProvider ?? "claude",
          DISABLE_AUTO_UPDATE: "true",
          DISABLE_UPDATE_PROMPT: "true",
        }),
      );
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

      // A process-level Cursor data-root override participates in discovery
      // even when it was not persisted in the original binding. Mirror it into
      // tmux before relaunch so the resumed CLI reads the same chat index.
      const cursorDataDir = discoveryEnv.CURSOR_DATA_DIR;
      if (
        provider.id === "cursor" &&
        cursorDataDir &&
        tmuxEnv.CURSOR_DATA_DIR !== cursorDataDir
      ) {
        await this.tmuxGateway.setEnvironment(
          tmuxName,
          TmuxEnvironment.create({ CURSOR_DATA_DIR: cursorDataDir }),
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
      const agentCommand =
        provider.id === "cursor" && cursorDataDir
          ? `CURSOR_DATA_DIR=${quoteShellArg(cursorDataDir)} ${baseAgentCommand}`
          : baseAgentCommand;
      log.info("Relaunching agent (HTTP restart)", {
        sessionId: input.sessionId,
        provider: provider.id,
        resumed,
      });
      await this.tmuxGateway.replaceAgentProcess(tmuxName, agentCommand);
      runningSession = await this.sessionRepository.completeAgentRestart(
        input.sessionId,
        input.userId,
        generation,
      );
      // An immediate replacement exit legitimately wins the CAS above.
      runningSession ??= await this.sessionRepository.findById(input.sessionId, input.userId);
      if (!runningSession) throw new Error("session disappeared while completing restart");
    } catch (error) {
      // A failure can happen before or after the gateway replaces the pane. Do
      // not publish `exited` while an old or partially launched process may
      // still be alive under an untrusted generation: first quarantine the
      // whole agent tmux session. If tmux cannot confirm that stop, retain the
      // `restarting` claim for the liveness reconciler instead of lying about
      // the process state.
      let processStopped = false;
      try {
        processStopped = await this.tmuxGateway.stopSessionAndConfirmAbsent(tmuxName);
      } catch (stopError) {
        log.error("Failed to confirm agent process stopped after restart failure", {
          sessionId: input.sessionId,
          error: String(stopError),
        });
      }
      if (processStopped) {
        try {
          await this.sessionRepository.failAgentRestart(input.sessionId, input.userId, generation);
        } catch {
          // Log but don't mask original error
          log.error("Failed to revert session state after restart failure", { sessionId: input.sessionId });
        }
      } else {
        log.error("Retaining restart claim until liveness can reconcile uncertain process", {
          sessionId: input.sessionId,
          generation,
        });
      }
      throw new RestartAgentError(
        `Failed to send restart command: ${(error as Error).message}`,
        "RESTART_FAILED",
        input.sessionId
      );
    }

    return {
      session: runningSession,
      wasRecreated: false,
      resumed,
    };
  }
}
