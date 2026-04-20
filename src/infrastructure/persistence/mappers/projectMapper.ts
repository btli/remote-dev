import { Project } from "@/domain/entities/Project";
import { projects } from "@/db/schema";

export type ProjectRow = typeof projects.$inferSelect;

export function toDomain(row: ProjectRow): Project {
  return Project.create({
    id: row.id,
    userId: row.userId,
    groupId: row.groupId,
    name: row.name,
    collapsed: row.collapsed,
    sortOrder: row.sortOrder,
    isAutoCreated: row.isAutoCreated,
    legacyFolderId: row.legacyFolderId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function toInsert(p: Project): typeof projects.$inferInsert {
  return {
    id: p.id,
    userId: p.userId,
    groupId: p.groupId,
    name: p.name,
    collapsed: p.collapsed,
    sortOrder: p.sortOrder,
    isAutoCreated: p.isAutoCreated,
    legacyFolderId: p.legacyFolderId,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}
