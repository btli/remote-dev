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
import { EntityNotFoundError, InvalidStateTransitionError } from "@/domain/errors/DomainError";

export interface RestartAgentInput {
  sessionId: string;
  userId: string;
}

export interface RestartAgentOutput {
  session: Session;
  wasRecreated: boolean;
}

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

/**
 * Get the agent CLI command based on provider.
 */
function getAgentCommand(provider: string | null): string {
  switch (provider) {
    case "claude":
      return "claude";
    case "codex":
      return "codex";
    case "gemini":
      return "gemini";
    case "opencode":
      return "opencode";
    default:
      return "claude"; // Default to Claude
  }
}

export class RestartAgentUseCase {
  constructor(
    private readonly sessionRepository: SessionRepository,
    private readonly tmuxGateway: TmuxGateway
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
    if (session.terminalType !== "agent") {
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
        console.error(`Failed to revert session state after tmux gone: ${input.sessionId}`);
      }
      throw new RestartAgentError(
        `Tmux session ${tmuxName} no longer exists. Session must be recreated.`,
        "TMUX_SESSION_GONE",
        input.sessionId
      );
    }

    // Tmux session exists - send the new agent command
    // Environment persists at tmux session level, no re-injection needed
    try {
      const agentCommand = getAgentCommand(session.agentProvider);
      await this.tmuxGateway.sendKeys(tmuxName, agentCommand);
    } catch (error) {
      // Revert session to exited state on failure to avoid stuck "restarting" state
      try {
        const revertedSession = restartingSession.markAgentExited(null);
        await this.sessionRepository.save(revertedSession);
      } catch {
        // Log but don't mask original error
        console.error(`Failed to revert session state after restart failure: ${input.sessionId}`);
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
    };
  }
}
