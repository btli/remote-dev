import { db } from "@/db";
import { projects } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * Translate a legacy `folderId` into the corresponding `projectId` produced by
 * the Phase 1 migration. Returns null if no mapping exists (e.g. the folder is
 * a container/group row that has no project-side equivalent).
 *
 * Phase 3 transition helper: used during dual-writes so downstream services can
 * keep accepting `folderId` from callers while still populating `projectId`.
 */
export async function translateFolderIdToProjectId(
  folderId: string,
  userId: string
): Promise<string | null> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.legacyFolderId, folderId), eq(projects.userId, userId)))
    .limit(1);
  return rows[0]?.id ?? null;
}
