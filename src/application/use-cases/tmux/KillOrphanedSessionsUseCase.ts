/**
 * KillOrphanedSessionsUseCase - Terminates all orphaned tmux sessions.
 *
 * An orphaned session is a tmux session that exists on the system but has no
 * corresponding record in the database. This typically happens when:
 * - The app crashes before cleaning up
 * - A session is deleted from the DB but tmux wasn't properly terminated
 * - Manual tmux session creation with rdv- prefix
 */

import type { TmuxGateway } from "@/application/ports/TmuxGateway";
import type { SessionRepository } from "@/application/ports/SessionRepository";
import { TmuxSystemSession, TMUX_SESSION_PREFIX } from "@/domain/entities/TmuxSystemSession";
import { TmuxSessionList } from "@/domain/value-objects/TmuxSessionList";

export interface KillOrphanedSessionsInput {
  userId: string;
}

export interface KillOrphanedSessionsOutput {
  success: boolean;
  killedCount: number;
  killedSessionNames: string[];
  errors: Array<{ sessionName: string; error: string }>;
}

export class KillOrphanedSessionsUseCase {
  constructor(
    private readonly tmuxGateway: TmuxGateway,
    private readonly sessionRepository: SessionRepository
  ) {}

  async execute(input: KillOrphanedSessionsInput): Promise<KillOrphanedSessionsOutput> {
    const { userId } = input;

    // 1. Fetch all tmux sessions
    const tmuxInfoList = await this.tmuxGateway.listSessions();

    // 2. Convert to domain entities (app-managed only)
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
    // SECURITY: We must check all users' sessions to avoid killing
    // another user's active session
    const allActiveTmuxNames = await this.sessionRepository.getAllActiveTmuxSessionNames();

    // 4. Build empty user map (we don't need user-specific info for cleanup)
    const emptyDbSessionMap = new Map<string, { dbSessionId: string; folderName: string | null }>();

    // 5. Identify orphans using global check
    const sessionList = TmuxSessionList.fromSessionsWithGlobalCheck(
      tmuxSessions,
      emptyDbSessionMap,
      allActiveTmuxNames
    );
    const orphanedNames = sessionList.getOrphanedNames();

    // 5. Kill each orphaned session
    const killedSessionNames: string[] = [];
    const errors: Array<{ sessionName: string; error: string }> = [];

    console.log(`[TmuxSession] User ${userId} killing ${orphanedNames.length} orphaned sessions`);

    for (const sessionName of orphanedNames) {
      try {
        await this.tmuxGateway.killSession(sessionName);
        killedSessionNames.push(sessionName);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error(`[TmuxSession] Failed to kill orphaned session ${sessionName}:`, errorMessage);
        errors.push({ sessionName, error: errorMessage });
      }
    }

    console.log(`[TmuxSession] Cleanup complete: ${killedSessionNames.length} killed, ${errors.length} errors`);

    return {
      success: errors.length === 0,
      killedCount: killedSessionNames.length,
      killedSessionNames,
      errors,
    };
  }
}
