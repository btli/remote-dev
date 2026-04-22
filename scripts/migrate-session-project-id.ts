#!/usr/bin/env bun
/**
 * One-time migration for Phase G0a: enforce terminal_session.project_id NOT NULL.
 *
 * Handles pre-Phase-G legacy sessions that have project_id IS NULL.
 * Strategy:
 *   1. For ACTIVE (status != 'closed') orphan sessions, backfill by assigning
 *      them to an auto-created "(Unassigned)" project per user.
 *   2. For CLOSED orphan sessions, delete them (they have no live state; the
 *      session_recording table keeps independent references via sessionId).
 *   3. Report counts.
 *
 * The script is idempotent — running it a second time should be a no-op.
 *
 * After this script runs clean, run `bun run db:push` to apply the NOT NULL
 * constraint on terminal_session.project_id.
 */

import { db } from "../src/db";
import {
  terminalSessions,
  projects,
  projectGroups,
  users,
} from "../src/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";

const UNASSIGNED_NAME = "(Unassigned)";

async function findOrCreateUnassignedProject(userId: string): Promise<string> {
  // Find or create an "(Unassigned)" auto-created project for this user.
  const existingProject = await db.query.projects.findFirst({
    where: and(
      eq(projects.userId, userId),
      eq(projects.name, UNASSIGNED_NAME),
      eq(projects.isAutoCreated, true)
    ),
  });
  if (existingProject) return existingProject.id;

  // Need a parent group. Prefer the earliest root group for the user.
  let rootGroup = await db.query.projectGroups.findFirst({
    where: and(
      eq(projectGroups.userId, userId),
      isNull(projectGroups.parentGroupId)
    ),
    orderBy: [asc(projectGroups.createdAt)],
  });

  if (!rootGroup) {
    // Create an "(Unassigned)" group as fallback.
    const groupId = crypto.randomUUID();
    const now = new Date();
    const [created] = await db
      .insert(projectGroups)
      .values({
        id: groupId,
        userId,
        parentGroupId: null,
        name: UNASSIGNED_NAME,
        collapsed: false,
        sortOrder: 9999,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    rootGroup = created;
    console.log(`    created root group "${UNASSIGNED_NAME}" for user=${userId}`);
  }

  const projectId = crypto.randomUUID();
  const now = new Date();
  await db.insert(projects).values({
    id: projectId,
    userId,
    groupId: rootGroup.id,
    name: UNASSIGNED_NAME,
    collapsed: false,
    sortOrder: 9999,
    isAutoCreated: true,
    createdAt: now,
    updatedAt: now,
  });
  console.log(
    `    created auto project "${UNASSIGNED_NAME}" id=${projectId} in group=${rootGroup.id}`
  );
  return projectId;
}

async function main() {
  console.log(
    "🔄 Phase G0a migration — enforce terminal_session.project_id NOT NULL\n"
  );

  // 1. Identify orphan sessions grouped by user/status.
  const orphans = await db.query.terminalSessions.findMany({
    where: isNull(terminalSessions.projectId),
  });

  const totalOrphans = orphans.length;
  const activeOrphans = orphans.filter((s) => s.status !== "closed");
  const closedOrphans = orphans.filter((s) => s.status === "closed");

  console.log(
    `  Found ${totalOrphans} orphan session(s): ${activeOrphans.length} active, ${closedOrphans.length} closed`
  );

  if (totalOrphans === 0) {
    console.log("\n✅ No orphans — nothing to do. Safe to run `bun run db:push`.\n");
    return;
  }

  // 2. Backfill active orphans via per-user "(Unassigned)" project.
  let backfilled = 0;
  if (activeOrphans.length > 0) {
    // Group active orphans by userId
    const byUser = new Map<string, typeof activeOrphans>();
    for (const s of activeOrphans) {
      const existing = byUser.get(s.userId) ?? [];
      existing.push(s);
      byUser.set(s.userId, existing);
    }

    console.log(
      `\n  → Backfilling ${activeOrphans.length} active orphan(s) across ${byUser.size} user(s)`
    );
    for (const [userId, userSessions] of byUser) {
      // Safety: confirm the user actually exists (foreign key guard).
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
      });
      if (!user) {
        console.log(
          `    ! user=${userId} not found — ${userSessions.length} session(s) left orphaned (will be caught by FK push)`
        );
        continue;
      }

      const targetProjectId = await findOrCreateUnassignedProject(userId);
      for (const s of userSessions) {
        await db
          .update(terminalSessions)
          .set({ projectId: targetProjectId, updatedAt: new Date() })
          .where(
            and(
              eq(terminalSessions.id, s.id),
              isNull(terminalSessions.projectId)
            )
          );
        backfilled++;
      }
      console.log(
        `    user=${userId} → project=${targetProjectId}: ${userSessions.length} session(s) reassigned`
      );
    }
  }

  // 3. Delete closed orphans.
  let deleted = 0;
  if (closedOrphans.length > 0) {
    console.log(
      `\n  → Deleting ${closedOrphans.length} closed orphan session(s)`
    );
    const result = await db
      .delete(terminalSessions)
      .where(
        and(
          isNull(terminalSessions.projectId),
          eq(terminalSessions.status, "closed")
        )
      );
    deleted = closedOrphans.length;
    console.log(`    deleted ${deleted} row(s) (drizzle result: ${JSON.stringify(result)})`);
  }

  // 4. Final check.
  const remaining = await db.query.terminalSessions.findMany({
    where: isNull(terminalSessions.projectId),
  });
  console.log(
    `\n  Summary: backfilled=${backfilled}, deleted=${deleted}, remaining_orphans=${remaining.length}`
  );

  if (remaining.length > 0) {
    console.log(
      "\n⚠  Orphans remain. Investigate before running `bun run db:push`."
    );
    process.exitCode = 1;
    return;
  }

  console.log("\n✅ Migration clean. Next: run `bun run db:push` to apply NOT NULL.\n");
}

main()
  .then(() => {
    // Bun/libsql process may hold a connection — exit cleanly.
    process.exit(process.exitCode ?? 0);
  })
  .catch((err) => {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  });
