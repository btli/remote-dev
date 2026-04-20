import { ProjectGroup } from "@/domain/entities/ProjectGroup";
import { ProjectGroupRepository } from "@/application/ports/ProjectGroupRepository";

export interface UpdateProjectGroupInput {
  id: string;
  name?: string;
  collapsed?: boolean;
  sortOrder?: number;
}

export class UpdateProjectGroup {
  constructor(private readonly repo: ProjectGroupRepository) {}

  async execute(input: UpdateProjectGroupInput): Promise<ProjectGroup> {
    const existing = await this.repo.findById(input.id);
    if (!existing) throw new Error(`Group ${input.id} not found`);
    let next = existing;
    if (input.name !== undefined) next = next.rename(input.name);
    if (input.collapsed !== undefined) next = next.setCollapsed(input.collapsed);
    if (input.sortOrder !== undefined) next = next.setSortOrder(input.sortOrder);
    await this.repo.save(next);
    return next;
  }
}
