/**
 * DrizzleSessionRepository - Drizzle ORM implementation of SessionRepository
 *
 * This repository handles all session persistence operations using Drizzle ORM.
 * It converts between database records and Session domain entities using SessionMapper.
 */

import { db } from "@/db";
import { terminalSessions } from "@/db/schema";
import { eq, and, asc, desc, inArray, max, isNull, isNotNull, sql } from "drizzle-orm";
import type { Session } from "@/domain/entities/Session";
import type {
  SessionRepository,
  SessionFilters,
  SessionOrderBy,
} from "@/application/ports/SessionRepository";
import { SessionMapper, type SessionDbRecord } from "../mappers/SessionMapper";

export class DrizzleSessionRepository implements SessionRepository {
  /**
   * Find a session by ID with user ownership check.
   */
  async findById(id: string, userId: string): Promise<Session | null> {
    const record = await db.query.terminalSessions.findFirst({
      where: and(
        eq(terminalSessions.id, id),
        eq(terminalSessions.userId, userId)
      ),
    });

    return record ? SessionMapper.toDomain(record as SessionDbRecord) : null;
  }

  /**
   * Find all sessions for a user with optional filters and ordering.
   */
  async findByUser(
    userId: string,
    options?: {
      filters?: SessionFilters;
      orderBy?: SessionOrderBy;
      limit?: number;
      offset?: number;
    }
  ): Promise<Session[]> {
    const conditions = [eq(terminalSessions.userId, userId)];

    // Apply filters
    if (options?.filters) {
      const { status, folderId, splitGroupId, hasWorktree } = options.filters;

      if (status) {
        const statusValues = Array.isArray(status) ? status : [status];
        conditions.push(
          inArray(
            terminalSessions.status,
            statusValues.map((s) => s.toString())
          )
        );
      }

      if (folderId !== undefined) {
        if (folderId === null) {
          conditions.push(isNull(terminalSessions.folderId));
        } else {
          conditions.push(eq(terminalSessions.folderId, folderId));
        }
      }

      if (splitGroupId !== undefined) {
        if (splitGroupId === null) {
          conditions.push(isNull(terminalSessions.splitGroupId));
        } else {
          conditions.push(eq(terminalSessions.splitGroupId, splitGroupId));
        }
      }

      if (hasWorktree !== undefined) {
        if (hasWorktree) {
          conditions.push(isNotNull(terminalSessions.worktreeBranch));
        } else {
          conditions.push(isNull(terminalSessions.worktreeBranch));
        }
      }
    }

    // Build order clause
    const orderClause = this.buildOrderClause(options?.orderBy);

    const records = await db.query.terminalSessions.findMany({
      where: and(...conditions),
      orderBy: orderClause,
      limit: options?.limit,
      offset: options?.offset,
    });

    return SessionMapper.toDomainMany(records as SessionDbRecord[]);
  }

  /**
   * Count sessions for a user with optional filters.
   */
  async count(userId: string, filters?: SessionFilters): Promise<number> {
    const conditions = [eq(terminalSessions.userId, userId)];

    if (filters) {
      const { status, folderId, splitGroupId, hasWorktree } = filters;

      if (status) {
        const statusValues = Array.isArray(status) ? status : [status];
        conditions.push(
          inArray(
            terminalSessions.status,
            statusValues.map((s) => s.toString())
          )
        );
      }

      if (folderId !== undefined) {
        if (folderId === null) {
          conditions.push(isNull(terminalSessions.folderId));
        } else {
          conditions.push(eq(terminalSessions.folderId, folderId));
        }
      }

      if (splitGroupId !== undefined) {
        if (splitGroupId === null) {
          conditions.push(isNull(terminalSessions.splitGroupId));
        } else {
          conditions.push(eq(terminalSessions.splitGroupId, splitGroupId));
        }
      }

      if (hasWorktree !== undefined) {
        if (hasWorktree) {
          conditions.push(isNotNull(terminalSessions.worktreeBranch));
        } else {
          conditions.push(isNull(terminalSessions.worktreeBranch));
        }
      }
    }

    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(terminalSessions)
      .where(and(...conditions));

    return result[0]?.count ?? 0;
  }

  /**
   * Find sessions by IDs (batch lookup).
   */
  async findByIds(ids: string[], userId: string): Promise<Session[]> {
    if (ids.length === 0) return [];

    const records = await db.query.terminalSessions.findMany({
      where: and(
        inArray(terminalSessions.id, ids),
        eq(terminalSessions.userId, userId)
      ),
    });

    return SessionMapper.toDomainMany(records as SessionDbRecord[]);
  }

  /**
   * Find sessions in a folder.
   */
  async findByFolder(folderId: string, userId: string): Promise<Session[]> {
    return this.findByUser(userId, {
      filters: { folderId },
      orderBy: { field: "tabOrder", direction: "asc" },
    });
  }

  /**
   * Find sessions in a split group.
   */
  async findBySplitGroup(
    splitGroupId: string,
    userId: string
  ): Promise<Session[]> {
    return this.findByUser(userId, {
      filters: { splitGroupId },
      orderBy: { field: "tabOrder", direction: "asc" },
    });
  }

  /**
   * Save a session (insert or update).
   * SECURITY: Always includes userId check to prevent cross-user data access.
   */
  async save(session: Session): Promise<Session> {
    const data = SessionMapper.toPersistence(session);

    // Check if exists - SECURITY: must check both id AND userId
    const existing = await db.query.terminalSessions.findFirst({
      where: and(
        eq(terminalSessions.id, session.id),
        eq(terminalSessions.userId, session.userId)
      ),
      columns: { id: true },
    });

    if (existing) {
      // Update - SECURITY: must check both id AND userId to prevent TOCTOU
      const [updated] = await db
        .update(terminalSessions)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(terminalSessions.id, session.id),
            eq(terminalSessions.userId, session.userId)
          )
        )
        .returning();

      return SessionMapper.toDomain(updated as SessionDbRecord);
    } else {
      // Insert
      const [inserted] = await db
        .insert(terminalSessions)
        .values(data)
        .returning();

      return SessionMapper.toDomain(inserted as SessionDbRecord);
    }
  }

  /**
   * Save multiple sessions in a batch (atomic).
   * SECURITY: Always includes userId check to prevent cross-user data access.
   */
  async saveMany(sessions: Session[]): Promise<void> {
    if (sessions.length === 0) return;

    await db.transaction(async (tx) => {
      for (const session of sessions) {
        const data = SessionMapper.toPersistence(session);

        // SECURITY: must check both id AND userId
        const existing = await tx.query.terminalSessions.findFirst({
          where: and(
            eq(terminalSessions.id, session.id),
            eq(terminalSessions.userId, session.userId)
          ),
          columns: { id: true },
        });

        if (existing) {
          // SECURITY: must check both id AND userId to prevent TOCTOU
          await tx
            .update(terminalSessions)
            .set({ ...data, updatedAt: new Date() })
            .where(
              and(
                eq(terminalSessions.id, session.id),
                eq(terminalSessions.userId, session.userId)
              )
            );
        } else {
          await tx.insert(terminalSessions).values(data);
        }
      }
    });
  }

  /**
   * Delete a session by ID.
   */
  async delete(id: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(terminalSessions)
      .where(
        and(eq(terminalSessions.id, id), eq(terminalSessions.userId, userId))
      );

    return result.rowsAffected > 0;
  }

  /**
   * Delete multiple sessions.
   */
  async deleteMany(ids: string[], userId: string): Promise<number> {
    if (ids.length === 0) return 0;

    const result = await db
      .delete(terminalSessions)
      .where(
        and(
          inArray(terminalSessions.id, ids),
          eq(terminalSessions.userId, userId)
        )
      );

    return result.rowsAffected;
  }

  /**
   * Update tab orders for multiple sessions atomically.
   */
  async updateTabOrders(
    orders: Array<{ id: string; tabOrder: number }>,
    userId: string
  ): Promise<void> {
    if (orders.length === 0) return;

    // Use transaction for atomicity
    await db.transaction(async (tx) => {
      await Promise.all(
        orders.map(({ id, tabOrder }) =>
          tx
            .update(terminalSessions)
            .set({ tabOrder, updatedAt: new Date() })
            .where(
              and(
                eq(terminalSessions.id, id),
                eq(terminalSessions.userId, userId)
              )
            )
        )
      );
    });
  }

  /**
   * Check if a session exists.
   */
  async exists(id: string, userId: string): Promise<boolean> {
    const result = await db.query.terminalSessions.findFirst({
      where: and(
        eq(terminalSessions.id, id),
        eq(terminalSessions.userId, userId)
      ),
      columns: { id: true },
    });

    return result !== null && result !== undefined;
  }

  /**
   * Get the next available tab order for a user.
   */
  async getNextTabOrder(userId: string): Promise<number> {
    const result = await db
      .select({ maxOrder: max(terminalSessions.tabOrder) })
      .from(terminalSessions)
      .where(
        and(
          eq(terminalSessions.userId, userId),
          inArray(terminalSessions.status, ["active", "suspended"])
        )
      );

    const maxOrder = result[0]?.maxOrder ?? -1;
    return maxOrder + 1;
  }

  /**
   * Get all active/suspended tmux session names across ALL users.
   * SECURITY: This is intentionally user-agnostic to prevent orphan detection
   * from incorrectly marking other users' sessions as orphaned.
   */
  async getAllActiveTmuxSessionNames(): Promise<Set<string>> {
    const result = await db
      .select({ tmuxSessionName: terminalSessions.tmuxSessionName })
      .from(terminalSessions)
      .where(inArray(terminalSessions.status, ["active", "suspended"]));

    return new Set(result.map((r) => r.tmuxSessionName));
  }

  /**
   * Build Drizzle order clause from SessionOrderBy.
   */
  private buildOrderClause(orderBy?: SessionOrderBy) {
    if (!orderBy) {
      return [asc(terminalSessions.tabOrder)];
    }

    const column = this.getOrderColumn(orderBy.field);
    return orderBy.direction === "desc" ? [desc(column)] : [asc(column)];
  }

  /**
   * Map order field name to Drizzle column.
   */
  private getOrderColumn(
    field: SessionOrderBy["field"]
  ) {
    switch (field) {
      case "tabOrder":
        return terminalSessions.tabOrder;
      case "createdAt":
        return terminalSessions.createdAt;
      case "updatedAt":
        return terminalSessions.updatedAt;
      case "lastActivityAt":
        return terminalSessions.lastActivityAt;
      case "name":
        return terminalSessions.name;
      default:
        return terminalSessions.tabOrder;
    }
  }
}
