/**
 * TmuxSessionList - Value object representing a collection of tmux sessions
 * with operations for filtering and aggregation.
 *
 * This value object encapsulates business logic for working with sets of
 * tmux sessions, including orphan detection.
 */

import { TmuxSystemSession } from "../entities/TmuxSystemSession";

export interface EnrichedTmuxSession {
  session: TmuxSystemSession;
  isOrphaned: boolean;
  /** Database session ID if tracked, null if orphaned */
  dbSessionId: string | null;
  /** Folder name if session belongs to a folder */
  folderName: string | null;
}

export class TmuxSessionList {
  private constructor(private readonly sessions: EnrichedTmuxSession[]) {}

  /**
   * Create a TmuxSessionList from raw tmux sessions and database session names.
   *
   * @param tmuxSessions - All tmux sessions from the system
   * @param dbSessionMap - Map of tmux session name -> { dbSessionId, folderName }
   * @deprecated Use fromSessionsWithGlobalCheck for proper multi-user orphan detection
   */
  static fromSessions(
    tmuxSessions: TmuxSystemSession[],
    dbSessionMap: Map<string, { dbSessionId: string; folderName: string | null }>
  ): TmuxSessionList {
    const enriched = tmuxSessions.map((session) => {
      const dbInfo = dbSessionMap.get(session.name);
      return {
        session,
        isOrphaned: !dbInfo,
        dbSessionId: dbInfo?.dbSessionId ?? null,
        folderName: dbInfo?.folderName ?? null,
      };
    });

    return new TmuxSessionList(enriched);
  }

  /**
   * Create a TmuxSessionList with proper multi-user orphan detection.
   *
   * SECURITY: Uses allActiveTmuxNames (from ALL users) for orphan detection,
   * but dbSessionMap (from requesting user only) for display info.
   *
   * @param tmuxSessions - All tmux sessions from the system
   * @param userDbSessionMap - Map of current user's sessions for display info
   * @param allActiveTmuxNames - Set of ALL users' active session names for orphan detection
   */
  static fromSessionsWithGlobalCheck(
    tmuxSessions: TmuxSystemSession[],
    userDbSessionMap: Map<string, { dbSessionId: string; folderName: string | null }>,
    allActiveTmuxNames: Set<string>
  ): TmuxSessionList {
    const enriched = tmuxSessions.map((session) => {
      const userDbInfo = userDbSessionMap.get(session.name);
      // SECURITY: Use global check for orphan detection
      const isOrphaned = !allActiveTmuxNames.has(session.name);
      return {
        session,
        isOrphaned,
        // Only show DB session ID if it belongs to this user
        dbSessionId: userDbInfo?.dbSessionId ?? null,
        folderName: userDbInfo?.folderName ?? null,
      };
    });

    return new TmuxSessionList(enriched);
  }

  /**
   * Get all sessions in the list.
   */
  getAll(): EnrichedTmuxSession[] {
    return [...this.sessions];
  }

  /**
   * Get only orphaned sessions (tmux sessions without DB records).
   */
  getOrphaned(): EnrichedTmuxSession[] {
    return this.sessions.filter((s) => s.isOrphaned);
  }

  /**
   * Get only tracked sessions (tmux sessions with DB records).
   */
  getTracked(): EnrichedTmuxSession[] {
    return this.sessions.filter((s) => !s.isOrphaned);
  }

  /**
   * Get only app-managed sessions (rdv- prefix).
   */
  getAppManaged(): EnrichedTmuxSession[] {
    return this.sessions.filter((s) => s.session.isAppManaged());
  }

  /**
   * Total count of sessions.
   */
  count(): number {
    return this.sessions.length;
  }

  /**
   * Count of orphaned sessions.
   */
  orphanedCount(): number {
    return this.getOrphaned().length;
  }

  /**
   * Count of tracked sessions.
   */
  trackedCount(): number {
    return this.getTracked().length;
  }

  /**
   * Check if there are any orphaned sessions.
   */
  hasOrphans(): boolean {
    return this.orphanedCount() > 0;
  }

  /**
   * Find a session by name.
   */
  findByName(name: string): EnrichedTmuxSession | null {
    return this.sessions.find((s) => s.session.name === name) ?? null;
  }

  /**
   * Get orphaned session names for cleanup.
   */
  getOrphanedNames(): string[] {
    return this.getOrphaned().map((s) => s.session.name);
  }

  /**
   * Sort sessions by created date (oldest first).
   */
  sortByCreated(): TmuxSessionList {
    const sorted = [...this.sessions].sort(
      (a, b) => a.session.created.getTime() - b.session.created.getTime()
    );
    return new TmuxSessionList(sorted);
  }

  /**
   * Sort sessions by name.
   */
  sortByName(): TmuxSessionList {
    const sorted = [...this.sessions].sort((a, b) =>
      a.session.name.localeCompare(b.session.name)
    );
    return new TmuxSessionList(sorted);
  }

  /**
   * Sort sessions with orphans first, then by created date.
   */
  sortOrphansFirst(): TmuxSessionList {
    const sorted = [...this.sessions].sort((a, b) => {
      // Orphans first
      if (a.isOrphaned !== b.isOrphaned) {
        return a.isOrphaned ? -1 : 1;
      }
      // Then by created date (newest first for better UX)
      return b.session.created.getTime() - a.session.created.getTime();
    });
    return new TmuxSessionList(sorted);
  }
}
