/**
 * ListTmuxSystemSessionsUseCase - Lists all tmux sessions with orphan detection.
 *
 * This use case fetches tmux sessions from the system and enriches them
 * with database information to identify orphaned sessions.
 */

import type { TmuxGateway } from "@/application/ports/TmuxGateway";
import type { SessionRepository } from "@/application/ports/SessionRepository";
import { TmuxSystemSession, TMUX_SESSION_PREFIX } from "@/domain/entities/TmuxSystemSession";
import { TmuxSessionList, type EnrichedTmuxSession } from "@/domain/value-objects/TmuxSessionList";
import { SessionStatus } from "@/domain/value-objects/SessionStatus";

export interface ListTmuxSystemSessionsInput {
  userId: string;
}

export interface ListTmuxSystemSessionsOutput {
  sessions: EnrichedTmuxSession[];
  totalCount: number;
  orphanedCount: number;
  trackedCount: number;
}

export class ListTmuxSystemSessionsUseCase {
  constructor(
    private readonly tmuxGateway: TmuxGateway,
    private readonly sessionRepository: SessionRepository
  ) {}

  async execute(input: ListTmuxSystemSessionsInput): Promise<ListTmuxSystemSessionsOutput> {
    // 1. Fetch all tmux sessions from the system
    const tmuxInfoList = await this.tmuxGateway.listSessions();

    // 2. Convert to domain entities (filter to app-managed sessions only)
    const tmuxSessions = tmuxInfoList
      .filter((info) => info.name.startsWith(TMUX_SESSION_PREFIX))
      .map((info) =>
        TmuxSystemSession.create({
          name: info.name,
          windowCount: info.windows ?? 1,
          created: info.created ?? new Date(),
          attached: info.attached ?? false,
        })
      );

    // 3. Get ALL active/suspended session names across ALL users
    // SECURITY: We must check all users' sessions to avoid incorrectly
    // marking another user's active session as "orphaned"
    const allActiveTmuxNames = await this.sessionRepository.getAllActiveTmuxSessionNames();

    // 4. For display purposes, also get the current user's sessions
    // (to show DB session ID and folder info for their sessions)
    const userSessions = await this.sessionRepository.findByUser(input.userId, {
      filters: {
        status: [SessionStatus.active(), SessionStatus.suspended()],
      },
    });

    // 5. Build a map of tmux name -> DB session info for the current user's sessions
    const dbSessionMap = new Map<string, { dbSessionId: string; folderName: string | null }>();
    for (const session of userSessions) {
      dbSessionMap.set(session.tmuxSessionName.toString(), {
        dbSessionId: session.id,
        folderName: null, // We'll enhance this if folder info is needed
      });
    }

    // 6. Create enriched session list using ALL users' session names for orphan detection
    const sessionList = TmuxSessionList.fromSessionsWithGlobalCheck(
      tmuxSessions,
      dbSessionMap,
      allActiveTmuxNames
    );
    const sorted = sessionList.sortOrphansFirst();

    return {
      sessions: sorted.getAll(),
      totalCount: sorted.count(),
      orphanedCount: sorted.orphanedCount(),
      trackedCount: sorted.trackedCount(),
    };
  }
}
