import { ProjectGroup } from "@/domain/entities/ProjectGroup";
import { projectGroups } from "@/db/schema";

export type ProjectGroupRow = typeof projectGroups.$inferSelect;

export function toDomain(row: ProjectGroupRow): ProjectGroup {
  return ProjectGroup.create({
    id: row.id,
    userId: row.userId,
    parentGroupId: row.parentGroupId,
    name: row.name,
    collapsed: row.collapsed,
    sortOrder: row.sortOrder,
    legacyFolderId: row.legacyFolderId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function toInsert(group: ProjectGroup): typeof projectGroups.$inferInsert {
  return {
    id: group.id,
    userId: group.userId,
    parentGroupId: group.parentGroupId,
    name: group.name,
    collapsed: group.collapsed,
    sortOrder: group.sortOrder,
    legacyFolderId: group.legacyFolderId,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}
