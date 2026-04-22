import { ProjectGroupRepository } from "@/application/ports/ProjectGroupRepository";
import { ProjectRepository } from "@/application/ports/ProjectRepository";
import { ProjectHierarchyError } from "@/domain/errors/ProjectHierarchyError";

export interface DeleteProjectGroupInput {
  id: string;
  force?: boolean;
}

export class DeleteProjectGroup {
  constructor(
    private readonly groupRepo: ProjectGroupRepository,
    private readonly projectRepo: ProjectRepository
  ) {}

  async execute(input: DeleteProjectGroupInput): Promise<void> {
    const descendants = await this.groupRepo.listDescendantGroupIds(input.id);
    const groupIds = [input.id, ...descendants];
    const projects = await this.projectRepo.listByGroupIds(groupIds);
    if (projects.length > 0 && !input.force) {
      throw new ProjectHierarchyError(
        `Group ${input.id} has ${projects.length} project(s); pass force to cascade`,
        "HAS_CHILDREN"
      );
    }
    await this.groupRepo.delete(input.id);
  }
}
