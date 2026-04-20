import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { Project } from "@/domain/entities/Project";
import { ProjectRepository } from "@/application/ports/ProjectRepository";
import * as mapper from "@/infrastructure/persistence/mappers/projectMapper";

const CHUNK = 500;

export class DrizzleProjectRepository implements ProjectRepository {
  async findById(id: string): Promise<Project | null> {
    const rows = await db.select().from(projects).where(eq(projects.id, id));
    return rows[0] ? mapper.toDomain(rows[0]) : null;
  }

  async listByUser(userId: string): Promise<Project[]> {
    const rows = await db.select().from(projects).where(eq(projects.userId, userId));
    return rows.map(mapper.toDomain);
  }

  async listByGroup(groupId: string): Promise<Project[]> {
    const rows = await db.select().from(projects).where(eq(projects.groupId, groupId));
    return rows.map(mapper.toDomain);
  }

  async listByGroupIds(groupIds: string[]): Promise<Project[]> {
    if (groupIds.length === 0) return [];
    const seen = new Set<string>();
    const out: Project[] = [];
    for (let i = 0; i < groupIds.length; i += CHUNK) {
      const slice = groupIds.slice(i, i + CHUNK);
      const rows = await db
        .select()
        .from(projects)
        .where(inArray(projects.groupId, slice));
      for (const r of rows) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          out.push(mapper.toDomain(r));
        }
      }
    }
    return out;
  }

  async save(p: Project): Promise<void> {
    const insert = mapper.toInsert(p);
    await db
      .insert(projects)
      .values(insert)
      .onConflictDoUpdate({
        target: projects.id,
        set: {
          groupId: insert.groupId,
          name: insert.name,
          collapsed: insert.collapsed,
          sortOrder: insert.sortOrder,
          updatedAt: insert.updatedAt,
        },
      });
  }

  async delete(id: string): Promise<void> {
    await db.delete(projects).where(eq(projects.id, id));
  }
}
