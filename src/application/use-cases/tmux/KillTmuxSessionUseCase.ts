/**
 * KillTmuxSessionUseCase - Terminates a single tmux session.
 *
 * This use case kills a tmux session by name. It validates that the session
 * name follows the expected format and delegates to the gateway.
 */

import type { TmuxGateway } from "@/application/ports/TmuxGateway";
import { InvalidValueError } from "@/domain/errors/DomainError";

export interface KillTmuxSessionInput {
  /** The tmux session name (e.g., "rdv-abc123-...") */
  sessionName: string;
  /** User ID for audit logging */
  userId: string;
}

export interface KillTmuxSessionOutput {
  success: boolean;
  sessionName: string;
}

export class KillTmuxSessionUseCase {
  constructor(private readonly tmuxGateway: TmuxGateway) {}

  async execute(input: KillTmuxSessionInput): Promise<KillTmuxSessionOutput> {
    const { sessionName, userId } = input;

    // Validate session name format
    if (!sessionName || typeof sessionName !== "string") {
      throw new InvalidValueError("sessionName", sessionName, "Must be a non-empty string");
    }

    // Security: Only allow killing rdv- prefixed sessions (our app's sessions)
    if (!sessionName.startsWith("rdv-")) {
      throw new InvalidValueError(
        "sessionName",
        sessionName,
        "Can only terminate app-managed sessions (rdv- prefix)"
      );
    }

    // Log the operation for audit trail
    console.log(`[TmuxSession] User ${userId} terminating session: ${sessionName}`);

    // Kill the session (idempotent - succeeds even if already gone)
    await this.tmuxGateway.killSession(sessionName);

    return {
      success: true,
      sessionName,
    };
  }
}
