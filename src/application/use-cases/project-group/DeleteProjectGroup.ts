import { ProjectGroupRepository } from "@/application/ports/ProjectGroupRepository";
import { ProjectRepository } from "@/application/ports/ProjectRepository";
import { ProjectHierarchyError } from "@/domain/errors/ProjectHierarchyError";
import type { DeleteProject } from "@/application/use-cases/project/DeleteProject";

export interface DeleteProjectGroupInput {
  id: string;
  force?: boolean;
}

/**
 * Delete a project group.
 *
 * Without `force`, the operation fails if the group has descendant projects
 * (preserves the existing "safety first" contract).
 *
 * With `force=true`, the operation recursively deletes ALL descendant
 * projects (via `DeleteProject`, which handles session/tmux side effects)
 * and all descendant groups before deleting the root group. This is
 * required because `projects.group_id` now uses `ON DELETE SET NULL`, so
 * a raw group delete would silently reparent descendants to root — see
 * remote-dev-nmw4 codex Finding 2.
 */
export class DeleteProjectGroup {
  constructor(
    private readonly groupRepo: ProjectGroupRepository,
    private readonly projectRepo: ProjectRepository,
    private readonly deleteProject: DeleteProject
  ) {}

  async execute(input: DeleteProjectGroupInput): Promise<void> {
    const descendantGroupIds = await this.groupRepo.listDescendantGroupIds(
      input.id
    );
    const allGroupIds = [input.id, ...descendantGroupIds];
    const projects = await this.projectRepo.listByGroupIds(allGroupIds);

    if (projects.length > 0 && !input.force) {
      throw new ProjectHierarchyError(
        `Group ${input.id} has ${projects.length} project(s); pass force to cascade`,
        "HAS_CHILDREN"
      );
    }

    if (input.force) {
      // 1. Delete all descendant projects first — FK `projects.group_id`
      //    uses ON DELETE SET NULL, so failing to do this would leave the
      //    projects alive at tree root.
      for (const project of projects) {
        await this.deleteProject.execute(project.id);
      }

      // 2. Delete descendant groups deepest-first so subgroup parent FKs
      //    cannot be satisfied by a surviving ancestor mid-traversal.
      //    We sort by descendant count: a leaf has 0, its parent has ≥1.
      const depthPairs: Array<{ id: string; descendantCount: number }> =
        await Promise.all(
          descendantGroupIds.map(async (gid) => ({
            id: gid,
            descendantCount: (await this.groupRepo.listDescendantGroupIds(gid))
              .length,
          }))
        );
      depthPairs.sort((a, b) => a.descendantCount - b.descendantCount);
      for (const { id } of depthPairs) {
        await this.groupRepo.delete(id);
      }
    }

    // 3. Finally, delete the root group.
    await this.groupRepo.delete(input.id);
  }
}
