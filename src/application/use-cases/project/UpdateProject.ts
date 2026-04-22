import { Project } from "@/domain/entities/Project";
import { ProjectRepository } from "@/application/ports/ProjectRepository";

export interface UpdateProjectInput {
  id: string;
  name?: string;
  collapsed?: boolean;
  sortOrder?: number;
}

export class UpdateProject {
  constructor(private readonly repo: ProjectRepository) {}

  async execute(input: UpdateProjectInput): Promise<Project> {
    const existing = await this.repo.findById(input.id);
    if (!existing) throw new Error(`Project ${input.id} not found`);
    let next = existing;
    if (input.name !== undefined) next = next.rename(input.name);
    if (input.collapsed !== undefined) next = next.setCollapsed(input.collapsed);
    if (input.sortOrder !== undefined) next = next.setSortOrder(input.sortOrder);
    await this.repo.save(next);
    return next;
  }
}
