import { randomUUID } from "node:crypto";
import { ProjectGroup } from "@/domain/entities/ProjectGroup";
import { ProjectGroupRepository } from "@/application/ports/ProjectGroupRepository";

export interface CreateProjectGroupInput {
  userId: string;
  name: string;
  parentGroupId: string | null;
  sortOrder?: number;
}

export class CreateProjectGroup {
  constructor(private readonly repo: ProjectGroupRepository) {}

  async execute(input: CreateProjectGroupInput): Promise<ProjectGroup> {
    const now = new Date();
    const group = ProjectGroup.create({
      id: randomUUID(),
      userId: input.userId,
      parentGroupId: input.parentGroupId,
      name: input.name,
      collapsed: false,
      sortOrder: input.sortOrder ?? 0,
      legacyFolderId: null,
      createdAt: now,
      updatedAt: now,
    });
    await this.repo.save(group);
    return group;
  }
}
