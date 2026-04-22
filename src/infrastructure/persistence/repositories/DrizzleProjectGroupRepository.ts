import { eq } from "drizzle-orm";
import { db, client } from "@/db";
import { projectGroups } from "@/db/schema";
import { ProjectGroup } from "@/domain/entities/ProjectGroup";
import { ProjectGroupRepository } from "@/application/ports/ProjectGroupRepository";
import * as mapper from "@/infrastructure/persistence/mappers/projectGroupMapper";

export class DrizzleProjectGroupRepository implements ProjectGroupRepository {
  async findById(id: string): Promise<ProjectGroup | null> {
    const rows = await db.select().from(projectGroups).where(eq(projectGroups.id, id));
    return rows[0] ? mapper.toDomain(rows[0]) : null;
  }

  async listByUser(userId: string): Promise<ProjectGroup[]> {
    const rows = await db.select().from(projectGroups).where(eq(projectGroups.userId, userId));
    return rows.map(mapper.toDomain);
  }

  async save(group: ProjectGroup): Promise<void> {
    const insert = mapper.toInsert(group);
    await db
      .insert(projectGroups)
      .values(insert)
      .onConflictDoUpdate({
        target: projectGroups.id,
        set: {
          parentGroupId: insert.parentGroupId,
          name: insert.name,
          collapsed: insert.collapsed,
          sortOrder: insert.sortOrder,
          updatedAt: insert.updatedAt,
        },
      });
  }

  async delete(id: string): Promise<void> {
    await db.delete(projectGroups).where(eq(projectGroups.id, id));
  }

  async listAncestry(groupId: string): Promise<ProjectGroup[]> {
    // Recursive CTE walking parentGroupId upward.
    // Use UNION (not UNION ALL) so cycles terminate; depth guard caps pathological data.
    const result = await client.execute({
      sql: `
        WITH RECURSIVE ancestry(id, parent_group_id, user_id, name, collapsed, sort_order, legacy_folder_id, created_at, updated_at, depth) AS (
          SELECT id, parent_group_id, user_id, name, collapsed, sort_order, legacy_folder_id, created_at, updated_at, 0
            FROM project_group WHERE id = ?
          UNION
          SELECT pg.id, pg.parent_group_id, pg.user_id, pg.name, pg.collapsed, pg.sort_order, pg.legacy_folder_id, pg.created_at, pg.updated_at, a.depth + 1
            FROM project_group pg JOIN ancestry a ON pg.id = a.parent_group_id
            WHERE a.depth < 128
        )
        SELECT * FROM ancestry ORDER BY depth ASC
      `,
      args: [groupId],
    });
    return result.rows.map((r) =>
      ProjectGroup.create({
        id: r.id as string,
        parentGroupId: r.parent_group_id as string | null,
        userId: r.user_id as string,
        name: r.name as string,
        collapsed: Boolean(r.collapsed),
        sortOrder: Number(r.sort_order),
        legacyFolderId: (r.legacy_folder_id as string | null) ?? null,
        createdAt: new Date(Number(r.created_at) * 1000),
        updatedAt: new Date(Number(r.updated_at) * 1000),
      })
    );
  }

  /**
   * Returns the given groupId plus all descendant group IDs, flattened.
   *
   * Cycle protection: `UNION` (not `UNION ALL`) deduplicates on `id`, so if the
   * graph ever contains a cycle the recursion terminates instead of looping.
   * A depth guard caps runaway recursion on pathological data.
   *
   * Includes the root `groupId` in the result so callers don't have to union
   * it in separately.
   */
  async listDescendantGroupIds(groupId: string): Promise<string[]> {
    const result = await client.execute({
      sql: `
        WITH RECURSIVE descendants(id, depth) AS (
          SELECT id, 0 FROM project_group WHERE id = ?
          UNION
          SELECT pg.id, d.depth + 1
          FROM project_group pg
          JOIN descendants d ON pg.parent_group_id = d.id
          WHERE d.depth < 128
        )
        SELECT id FROM descendants
      `,
      args: [groupId],
    });
    return result.rows.map((r) => r.id as string);
  }
}
