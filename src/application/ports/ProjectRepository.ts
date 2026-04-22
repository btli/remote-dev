import { Project } from "@/domain/entities/Project";

export interface ProjectRepository {
  findById(id: string): Promise<Project | null>;
  listByUser(userId: string): Promise<Project[]>;
  listByGroup(groupId: string): Promise<Project[]>;
  listByGroupIds(groupIds: string[]): Promise<Project[]>;
  save(project: Project): Promise<void>;
  delete(id: string): Promise<void>;
}
