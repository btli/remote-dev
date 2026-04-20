import { ProjectGroupRepository } from "@/application/ports/ProjectGroupRepository";
import { ProjectHierarchyError } from "@/domain/errors/ProjectHierarchyError";

export interface MoveProjectGroupInput {
  id: string;
  newParentGroupId: string | null;
}

export class MoveProjectGroup {
  constructor(private readonly repo: ProjectGroupRepository) {}

  async execute(input: MoveProjectGroupInput): Promise<void> {
    const existing = await this.repo.findById(input.id);
    if (!existing) throw new Error(`Group ${input.id} not found`);
    if (input.newParentGroupId) {
      const descendants = await this.repo.listDescendantGroupIds(input.id);
      if (
        descendants.includes(input.newParentGroupId) ||
        input.newParentGroupId === input.id
      ) {
        throw ProjectHierarchyError.cycleDetected(input.id);
      }
    }
    const moved = existing.moveUnder(input.newParentGroupId);
    await this.repo.save(moved);
  }
}
