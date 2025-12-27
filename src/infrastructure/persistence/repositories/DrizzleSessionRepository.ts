/**
 * DrizzleSessionRepository - Drizzle ORM implementation of SessionRepository
 *
 * This repository handles all session persistence operations using Drizzle ORM.
 * It converts between database records and Session domain entities using SessionMapper.
 */

import { db } from "@/db";
import { terminalSessions } from "@/db/schema";
import { eq, and, asc, desc, inArray, max, isNull } from "drizzle-orm";
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
          // Has worktree: worktreeBranch is not null
          conditions.push(
            // Can't easily do NOT NULL in Drizzle's query builder,
            // so we'll filter in JS for this edge case
          );
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

    let sessions = SessionMapper.toDomainMany(records as SessionDbRecord[]);

    // Post-filter for hasWorktree if specified
    if (options?.filters?.hasWorktree !== undefined) {
      sessions = sessions.filter(
        (s) => s.hasWorktree() === options.filters!.hasWorktree
      );
    }

    return sessions;
  }

  /**
   * Count sessions for a user with optional filters.
   */
  async count(userId: string, filters?: SessionFilters): Promise<number> {
    // For simplicity, we fetch and count. For large datasets,
    // this should use a proper COUNT query.
    const sessions = await this.findByUser(userId, { filters });
    return sessions.length;
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
   */
  async save(session: Session): Promise<Session> {
    const data = SessionMapper.toPersistence(session);

    // Check if exists
    const existing = await db.query.terminalSessions.findFirst({
      where: eq(terminalSessions.id, session.id),
    });

    if (existing) {
      // Update
      const [updated] = await db
        .update(terminalSessions)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(eq(terminalSessions.id, session.id))
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
   * Save multiple sessions in a batch.
   */
  async saveMany(sessions: Session[]): Promise<void> {
    if (sessions.length === 0) return;

    // For simplicity, save one by one. Could be optimized with batch upsert.
    await Promise.all(sessions.map((s) => this.save(s)));
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
