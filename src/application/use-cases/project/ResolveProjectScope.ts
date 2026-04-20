import { NodeRef } from "@/domain/value-objects/NodeRef";
import { ProjectGroupRepository } from "@/application/ports/ProjectGroupRepository";
import { ProjectRepository } from "@/application/ports/ProjectRepository";

export class ResolveProjectScope {
  constructor(
    private readonly groupRepo: ProjectGroupRepository,
    private readonly projectRepo: ProjectRepository
  ) {}

  async execute(node: NodeRef): Promise<string[]> {
    if (node.isProject()) {
      return [node.id];
    }
    const descendants = await this.groupRepo.listDescendantGroupIds(node.id);
    const projects = await this.projectRepo.listByGroupIds([
      node.id,
      ...descendants,
    ]);
    return projects.map((p) => p.id);
  }
}
