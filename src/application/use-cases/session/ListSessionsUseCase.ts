/**
 * ListSessionsUseCase - Lists sessions for a user with optional filtering.
 */

import type { Session } from "@/domain/entities/Session";
import type { SessionRepository } from "@/application/ports/SessionRepository";
import { SessionStatus } from "@/domain/value-objects/SessionStatus";

export interface ListSessionsInput {
  userId: string;
  status?: string | string[];
}

export class ListSessionsUseCase {
  constructor(private readonly sessionRepository: SessionRepository) {}

  async execute(input: ListSessionsInput): Promise<Session[]> {
    // Convert status strings to SessionStatus objects
    let statusFilter: SessionStatus | SessionStatus[] | undefined;

    if (input.status) {
      if (Array.isArray(input.status)) {
        statusFilter = input.status.map((s) => SessionStatus.fromString(s));
      } else {
        statusFilter = SessionStatus.fromString(input.status);
      }
    }

    return this.sessionRepository.findByUser(input.userId, {
      filters: statusFilter ? { status: statusFilter } : undefined,
      orderBy: { field: "tabOrder", direction: "asc" },
    });
  }
}
