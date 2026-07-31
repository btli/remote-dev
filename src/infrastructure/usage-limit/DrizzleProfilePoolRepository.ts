/**
 * DrizzleProfilePoolRepository - Drizzle implementation of the
 * ProfilePoolRepository port over `claude_profile_pool(_member)`.
 */

import { db } from "@/db";
import { affectedRows } from "@/db/sql-helpers";
import {
  claudeProfilePools,
  claudeProfilePoolMembers,
  projectProfileLinks,
} from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import type {
  ProfilePoolRepository,
  PoolEntry,
  PoolSummary,
} from "@/application/ports/ProfilePoolRepository";

export class DrizzleProfilePoolRepository implements ProfilePoolRepository {
  async membersOfPool(poolId: string): Promise<PoolEntry[]> {
    const rows = await db.query.claudeProfilePoolMembers.findMany({
      where: eq(claudeProfilePoolMembers.poolId, poolId),
      orderBy: [asc(claudeProfilePoolMembers.priority)],
    });
    return rows.map((r) => ({ accountId: r.accountId, priority: r.priority }));
  }

  async poolsForUser(userId: string): Promise<PoolSummary[]> {
    const rows = await db.query.claudeProfilePools.findMany({
      where: eq(claudeProfilePools.userId, userId),
      orderBy: [asc(claudeProfilePools.name)],
    });
    return rows.map((r) => ({ id: r.id, name: r.name }));
  }

  async getPool(poolId: string, userId: string): Promise<PoolSummary | null> {
    const row = await db.query.claudeProfilePools.findFirst({
      where: and(
        eq(claudeProfilePools.id, poolId),
        eq(claudeProfilePools.userId, userId)
      ),
    });
    return row ? { id: row.id, name: row.name } : null;
  }

  async createPool(userId: string, name: string): Promise<string> {
    const id = crypto.randomUUID();
    await db.insert(claudeProfilePools).values({ id, userId, name });
    return id;
  }

  async renamePool(poolId: string, name: string): Promise<void> {
    await db
      .update(claudeProfilePools)
      .set({ name, updatedAt: new Date() })
      .where(eq(claudeProfilePools.id, poolId));
  }

  async deletePool(poolId: string): Promise<void> {
    // Null any project links that pinned this pool. `project_profile_link.pool_id`
    // is intentionally NOT a DB-level FK (a table-level FK on that pre-existing
    // table breaks drizzle-kit db:push idempotency — see schema.def.ts), so the
    // former `ON DELETE SET NULL` behaviour is enforced here in the app.
    await db
      .update(projectProfileLinks)
      .set({ poolId: null })
      .where(eq(projectProfileLinks.poolId, poolId));
    // Members still cascade via their own (retained) FK onDelete: "cascade".
    await db.delete(claudeProfilePools).where(eq(claudeProfilePools.id, poolId));
  }

  async addMember(
    poolId: string,
    accountId: string,
    priority: number
  ): Promise<void> {
    await db
      .insert(claudeProfilePoolMembers)
      .values({ id: crypto.randomUUID(), poolId, accountId, priority })
      .onConflictDoUpdate({
        target: [
          claudeProfilePoolMembers.poolId,
          claudeProfilePoolMembers.accountId,
        ],
        set: { priority },
      });
  }

  async removeMember(poolId: string, accountId: string): Promise<void> {
    await db
      .delete(claudeProfilePoolMembers)
      .where(
        and(
          eq(claudeProfilePoolMembers.poolId, poolId),
          eq(claudeProfilePoolMembers.accountId, accountId)
        )
      );
  }

  async setPriority(
    poolId: string,
    accountId: string,
    priority: number
  ): Promise<void> {
    const result = await db
      .update(claudeProfilePoolMembers)
      .set({ priority })
      .where(
        and(
          eq(claudeProfilePoolMembers.poolId, poolId),
          eq(claudeProfilePoolMembers.accountId, accountId)
        )
      );
    // No row to update means the account isn't a member yet — add it.
    if (affectedRows(result) === 0) {
      await this.addMember(poolId, accountId, priority);
    }
  }
}
