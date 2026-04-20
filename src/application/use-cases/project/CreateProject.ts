import { randomUUID } from "node:crypto";
import { Project } from "@/domain/entities/Project";
import { ProjectRepository } from "@/application/ports/ProjectRepository";
import { ProjectGroupRepository } from "@/application/ports/ProjectGroupRepository";
import { ProjectHierarchyError } from "@/domain/errors/ProjectHierarchyError";

export interface CreateProjectInput {
  userId: string;
  groupId: string;
  name: string;
  sortOrder?: number;
}

export class CreateProject {
  constructor(
    private readonly projectRepo: ProjectRepository,
    private readonly groupRepo: ProjectGroupRepository
  ) {}

  async execute(input: CreateProjectInput): Promise<Project> {
    const group = await this.groupRepo.findById(input.groupId);
    if (!group) {
      throw new ProjectHierarchyError(
        `Group ${input.groupId} not found`,
        "MISSING_GROUP"
      );
    }
    if (group.userId !== input.userId) {
      throw new ProjectHierarchyError(
        "Group belongs to a different user",
        "SCOPE_MISMATCH"
      );
    }
    const now = new Date();
    const project = Project.create({
      id: randomUUID(),
      userId: input.userId,
      groupId: input.groupId,
      name: input.name,
      collapsed: false,
      sortOrder: input.sortOrder ?? 0,
      isAutoCreated: false,
      legacyFolderId: null,
      createdAt: now,
      updatedAt: now,
    });
    await this.projectRepo.save(project);
    return project;
  }
}
