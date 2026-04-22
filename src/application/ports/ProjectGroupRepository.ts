import { ProjectGroup } from "@/domain/entities/ProjectGroup";

export interface ProjectGroupRepository {
  findById(id: string): Promise<ProjectGroup | null>;
  listByUser(userId: string): Promise<ProjectGroup[]>;
  save(group: ProjectGroup): Promise<void>;
  delete(id: string): Promise<void>;
  listAncestry(groupId: string): Promise<ProjectGroup[]>;
  listDescendantGroupIds(groupId: string): Promise<string[]>;
}
