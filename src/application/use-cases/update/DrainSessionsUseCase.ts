/**
 * DrainSessionsUseCase - Notifies connected clients of a pending restart
 * and waits for active sessions to drain.
 *
 * The drain is advisory, not blocking. After the configured timeout,
 * the use case resolves regardless of remaining active sessions.
 * Agent tmux sessions survive server restarts, so interrupted agents
 * can be resumed post-update.
 */

import type { SessionDrainGateway, DrainStatus } from "@/application/ports/SessionDrainGateway";
import type { DeploymentRepository } from "@/application/ports/DeploymentRepository";
import type { UpdateDeployment } from "@/domain/entities/UpdateDeployment";
import type { UpdatePolicy } from "@/domain/value-objects/UpdatePolicy";
import { createLogger } from "@/lib/logger";

const log = createLogger("DrainSessions");

export interface DrainSessionsInput {
  deployment: UpdateDeployment;
  policy: UpdatePolicy;
}

export interface DrainSessionsOutput {
  drained: boolean;
  remainingSessions: number;
  remainingAgentSessions: number;
  elapsedSeconds: number;
}

export class DrainSessionsUseCase {
  constructor(
    private readonly sessionDrainGateway: SessionDrainGateway,
    private readonly deploymentRepository: DeploymentRepository
  ) {}

  async execute(input: DrainSessionsInput): Promise<DrainSessionsOutput> {
    const { deployment, policy } = input;
    const startTime = Date.now();

    // Transition to draining stage
    const drainingDeployment = deployment.startDrain();
    await this.deploymentRepository.save(drainingDeployment);

    log.info("Starting session drain", {
      version: deployment.version,
      timeoutSeconds: policy.drainTimeoutSeconds,
    });

    // Initial drain notification
    let status: DrainStatus;
    // Intentional fail-open: if the terminal server is unreachable,
    // we cannot query session count but should not block the update.
    // Agent tmux sessions survive restarts, so interrupted agents resume.
    try {
      status = await this.sessionDrainGateway.notifyDrain(
        policy.drainTimeoutSeconds,
        deployment.version
      );
    } catch (error) {
      log.warn("Terminal server unreachable, skipping drain", { error: String(error) });
      return {
        drained: false,
        remainingSessions: 0,
        remainingAgentSessions: 0,
        elapsedSeconds: 0,
      };
    }

    if (status.activeSessions === 0) {
      log.info("No active sessions, drain complete immediately");
      return {
        drained: true,
        remainingSessions: 0,
        remainingAgentSessions: 0,
        elapsedSeconds: 0,
      };
    }

    log.info("Waiting for sessions to drain", {
      activeSessions: status.activeSessions,
      activeAgentSessions: status.activeAgentSessions,
    });

    // Poll until drained or timeout.
    // Use getActiveSessionCount for subsequent polls to avoid re-broadcasting
    // the drain warning to all clients on every poll cycle.
    const deadline = startTime + policy.drainTimeoutMs;
    while (Date.now() < deadline) {
      await sleep(Math.min(policy.drainPollIntervalMs, deadline - Date.now()));

      try {
        status = await this.sessionDrainGateway.getActiveSessionCount();
      } catch (error) {
        log.warn("Drain poll failed, proceeding", { error: String(error) });
        break;
      }

      if (status.activeSessions === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        log.info("All sessions drained", { elapsedSeconds: elapsed });
        return {
          drained: true,
          remainingSessions: 0,
          remainingAgentSessions: 0,
          elapsedSeconds: elapsed,
        };
      }
    }

    // Timeout — proceed anyway
    const elapsed = (Date.now() - startTime) / 1000;
    log.warn("Drain timeout reached, proceeding with update", {
      remainingSessions: status.activeSessions,
      remainingAgentSessions: status.activeAgentSessions,
      elapsedSeconds: elapsed,
    });

    return {
      drained: false,
      remainingSessions: status.activeSessions,
      remainingAgentSessions: status.activeAgentSessions,
      elapsedSeconds: elapsed,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
