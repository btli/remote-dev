import { container } from "@/infrastructure/container";
import { ProjectGroup } from "@/domain/entities/ProjectGroup";

export class GroupService {
  static async list(userId: string): Promise<ProjectGroup[]> {
    return container.projectGroupRepository.listByUser(userId);
  }

  static async get(id: string): Promise<ProjectGroup | null> {
    return container.projectGroupRepository.findById(id);
  }

  static async create(input: {
    userId: string;
    name: string;
    parentGroupId: string | null;
    sortOrder?: number;
  }): Promise<ProjectGroup> {
    return container.useCases.createProjectGroup.execute(input);
  }

  static async update(input: {
    id: string;
    name?: string;
    collapsed?: boolean;
    sortOrder?: number;
  }): Promise<ProjectGroup> {
    return container.useCases.updateProjectGroup.execute(input);
  }

  static async move(input: {
    id: string;
    newParentGroupId: string | null;
  }): Promise<void> {
    return container.useCases.moveProjectGroup.execute(input);
  }

  static async delete(input: { id: string; force?: boolean }): Promise<void> {
    return container.useCases.deleteProjectGroup.execute(input);
  }
}
