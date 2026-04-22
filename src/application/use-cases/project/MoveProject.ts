import { ProjectRepository } from "@/application/ports/ProjectRepository";
import { ProjectGroupRepository } from "@/application/ports/ProjectGroupRepository";
import { ProjectHierarchyError } from "@/domain/errors/ProjectHierarchyError";

export interface MoveProjectInput {
  id: string;
  // Null means move the project to the tree root.
  newGroupId: string | null;
}

export class MoveProject {
  constructor(
    private readonly projectRepo: ProjectRepository,
    private readonly groupRepo: ProjectGroupRepository
  ) {}

  async execute(input: MoveProjectInput): Promise<void> {
    const project = await this.projectRepo.findById(input.id);
    if (!project) throw new Error(`Project ${input.id} not found`);
    if (input.newGroupId !== null) {
      const group = await this.groupRepo.findById(input.newGroupId);
      if (!group) {
        throw new ProjectHierarchyError(
          `Group ${input.newGroupId} not found`,
          "MISSING_GROUP"
        );
      }
      if (group.userId !== project.userId) {
        throw new ProjectHierarchyError(
          "Cross-user move is forbidden",
          "SCOPE_MISMATCH"
        );
      }
    }
    await this.projectRepo.save(project.moveTo(input.newGroupId));
  }
}
