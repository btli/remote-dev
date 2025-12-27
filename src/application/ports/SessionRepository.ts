/**
 * SessionRepository - Port interface for session persistence.
 *
 * This interface defines the contract for session data access.
 * Implementations can use any persistence mechanism (Drizzle, Prisma, in-memory, etc.)
 *
 * Repository methods return domain entities (Session), not database records.
 * The implementation is responsible for mapping between DB and domain types.
 */

import type { Session } from "@/domain/entities/Session";
import type { SessionStatus } from "@/domain/value-objects/SessionStatus";

export interface SessionFilters {
  /** Filter by status */
  status?: SessionStatus | SessionStatus[];
  /** Filter by folder ID (null = root sessions) */
  folderId?: string | null;
  /** Filter by split group ID */
  splitGroupId?: string | null;
  /** Filter by project path */
  projectPath?: string;
  /** Filter sessions with worktrees */
  hasWorktree?: boolean;
}

export interface SessionOrderBy {
  field: "tabOrder" | "createdAt" | "updatedAt" | "lastActivityAt" | "name";
  direction: "asc" | "desc";
}

export interface SessionRepository {
  /**
   * Find a session by ID.
   * Returns null if not found or doesn't belong to user.
   */
  findById(id: string, userId: string): Promise<Session | null>;

  /**
   * Find all sessions for a user.
   */
  findByUser(
    userId: string,
    options?: {
      filters?: SessionFilters;
      orderBy?: SessionOrderBy;
      limit?: number;
      offset?: number;
    }
  ): Promise<Session[]>;

  /**
   * Count sessions for a user (with optional filters).
   */
  count(userId: string, filters?: SessionFilters): Promise<number>;

  /**
   * Find sessions by IDs (batch lookup).
   */
  findByIds(ids: string[], userId: string): Promise<Session[]>;

  /**
   * Find sessions in a folder.
   */
  findByFolder(folderId: string, userId: string): Promise<Session[]>;

  /**
   * Find sessions in a split group.
   */
  findBySplitGroup(splitGroupId: string, userId: string): Promise<Session[]>;

  /**
   * Save a session (insert or update).
   * Returns the saved session (may have updated timestamps).
   */
  save(session: Session): Promise<Session>;

  /**
   * Save multiple sessions in a batch.
   */
  saveMany(sessions: Session[]): Promise<void>;

  /**
   * Delete a session by ID.
   * Returns true if deleted, false if not found.
   */
  delete(id: string, userId: string): Promise<boolean>;

  /**
   * Delete multiple sessions.
   */
  deleteMany(ids: string[], userId: string): Promise<number>;

  /**
   * Update tab orders for multiple sessions atomically.
   */
  updateTabOrders(
    orders: Array<{ id: string; tabOrder: number }>,
    userId: string
  ): Promise<void>;

  /**
   * Check if a session exists.
   */
  exists(id: string, userId: string): Promise<boolean>;

  /**
   * Get the next available tab order for a user.
   */
  getNextTabOrder(userId: string): Promise<number>;
}
