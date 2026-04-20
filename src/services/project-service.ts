import { container } from "@/infrastructure/container";
import { Project } from "@/domain/entities/Project";

export class ProjectService {
  static async listByUser(userId: string): Promise<Project[]> {
    return container.projectRepository.listByUser(userId);
  }

  static async listByGroup(groupId: string): Promise<Project[]> {
    return container.projectRepository.listByGroup(groupId);
  }

  static async get(id: string): Promise<Project | null> {
    return container.projectRepository.findById(id);
  }

  static async create(input: {
    userId: string;
    groupId: string;
    name: string;
    sortOrder?: number;
  }): Promise<Project> {
    return container.useCases.createProject.execute(input);
  }

  static async update(input: {
    id: string;
    name?: string;
    collapsed?: boolean;
    sortOrder?: number;
  }): Promise<Project> {
    return container.useCases.updateProject.execute(input);
  }

  static async move(input: {
    id: string;
    newGroupId: string;
  }): Promise<void> {
    return container.useCases.moveProject.execute(input);
  }

  static async delete(id: string): Promise<void> {
    return container.useCases.deleteProject.execute(id);
  }
}
