/**
 * DeleteProjectGroup — cascade semantics.
 *
 * Covers remote-dev-nmw4 codex Finding 2: after widening projects.group_id to
 * NULL + changing the FK to ON DELETE SET NULL (so that projects can live at
 * root), the force=true delete path MUST explicitly remove descendant
 * projects and subgroups or they silently reparent to root.
 */
import { describe, it, expect, vi } from "vitest";
import { DeleteProjectGroup } from "@/application/use-cases/project-group/DeleteProjectGroup";
import type { ProjectGroupRepository } from "@/application/ports/ProjectGroupRepository";
import type { ProjectRepository } from "@/application/ports/ProjectRepository";
import type { DeleteProject } from "@/application/use-cases/project/DeleteProject";
import type { Project } from "@/domain/entities/Project";

function makeProject(id: string, groupId: string | null): Project {
  return {
    id,
    groupId,
    userId: "u1",
  } as unknown as Project;
}

type GroupRepoMock = Pick<ProjectGroupRepository, "delete" | "listDescendantGroupIds">;
type ProjectRepoMock = Pick<ProjectRepository, "listByGroupIds">;

describe("DeleteProjectGroup", () => {
  it("without force, throws when projects exist beneath the group", async () => {
    const groupRepo: GroupRepoMock = {
      delete: vi.fn(async () => {}),
      listDescendantGroupIds: vi.fn(async () => []),
    };
    const projectRepo: ProjectRepoMock = {
      listByGroupIds: vi.fn(async () => [makeProject("p1", "g1")]),
    };
    const deleteProject = {
      execute: vi.fn(async () => {}),
    };
    const uc = new DeleteProjectGroup(
      groupRepo as ProjectGroupRepository,
      projectRepo as ProjectRepository,
      deleteProject as unknown as DeleteProject,
    );
    await expect(uc.execute({ id: "g1" })).rejects.toThrow();
    expect(groupRepo.delete).not.toHaveBeenCalled();
    expect(deleteProject.execute).not.toHaveBeenCalled();
  });

  it("with force, deletes descendant projects BEFORE deleting the group", async () => {
    const callOrder: string[] = [];
    const groupRepo: GroupRepoMock = {
      delete: vi.fn(async (id: string) => {
        callOrder.push(`delete-group:${id}`);
      }),
      listDescendantGroupIds: vi.fn(async () => []),
    };
    const projectRepo: ProjectRepoMock = {
      listByGroupIds: vi.fn(async () => [
        makeProject("p1", "g1"),
        makeProject("p2", "g1"),
      ]),
    };
    const deleteProject = {
      execute: vi.fn(async (id: string) => {
        callOrder.push(`delete-project:${id}`);
      }),
    };
    const uc = new DeleteProjectGroup(
      groupRepo as ProjectGroupRepository,
      projectRepo as ProjectRepository,
      deleteProject as unknown as DeleteProject,
    );
    await uc.execute({ id: "g1", force: true });
    expect(deleteProject.execute).toHaveBeenCalledTimes(2);
    expect(deleteProject.execute).toHaveBeenCalledWith("p1");
    expect(deleteProject.execute).toHaveBeenCalledWith("p2");
    expect(groupRepo.delete).toHaveBeenCalledWith("g1");
    // Group must be deleted AFTER its projects so descendants cannot survive.
    const lastProjectIdx = Math.max(
      callOrder.indexOf("delete-project:p1"),
      callOrder.indexOf("delete-project:p2"),
    );
    const groupIdx = callOrder.indexOf("delete-group:g1");
    expect(groupIdx).toBeGreaterThan(lastProjectIdx);
  });

  it("with force, deletes subgroups deepest-first and their projects", async () => {
    // Topology:
    //   g1
    //   ├── g2
    //   │   └── g3 (leaf)
    //   └── (project p1 under g1)
    const callOrder: string[] = [];
    const groupRepo: GroupRepoMock = {
      delete: vi.fn(async (id: string) => {
        callOrder.push(`delete-group:${id}`);
      }),
      // Root group returns the full descendant set.
      listDescendantGroupIds: vi.fn(async (id: string) => {
        if (id === "g1") return ["g2", "g3"];
        if (id === "g2") return ["g3"];
        return [];
      }),
    };
    const projectRepo: ProjectRepoMock = {
      listByGroupIds: vi.fn(async (ids: string[]) => {
        // Only one project; it lives directly under g1.
        if (ids.includes("g1")) return [makeProject("p1", "g1")];
        return [];
      }),
    };
    const deleteProject = {
      execute: vi.fn(async (id: string) => {
        callOrder.push(`delete-project:${id}`);
      }),
    };
    const uc = new DeleteProjectGroup(
      groupRepo as ProjectGroupRepository,
      projectRepo as ProjectRepository,
      deleteProject as unknown as DeleteProject,
    );
    await uc.execute({ id: "g1", force: true });

    // All descendant groups must be gone, plus the root.
    expect(groupRepo.delete).toHaveBeenCalledWith("g1");
    expect(groupRepo.delete).toHaveBeenCalledWith("g2");
    expect(groupRepo.delete).toHaveBeenCalledWith("g3");
    expect(groupRepo.delete).toHaveBeenCalledTimes(3);
    // Projects must be deleted (no orphans at root).
    expect(deleteProject.execute).toHaveBeenCalledWith("p1");
    // Root group must be deleted last (after all descendants).
    const rootIdx = callOrder.lastIndexOf("delete-group:g1");
    const g2Idx = callOrder.indexOf("delete-group:g2");
    const g3Idx = callOrder.indexOf("delete-group:g3");
    expect(rootIdx).toBeGreaterThan(g2Idx);
    expect(rootIdx).toBeGreaterThan(g3Idx);
    // Deepest-first: g3 before g2.
    expect(g3Idx).toBeLessThan(g2Idx);
  });

  it("without force, succeeds (deletes only the group) when there are NO descendants", async () => {
    const groupRepo: GroupRepoMock = {
      delete: vi.fn(async () => {}),
      listDescendantGroupIds: vi.fn(async () => []),
    };
    const projectRepo: ProjectRepoMock = {
      listByGroupIds: vi.fn(async () => []),
    };
    const deleteProject = {
      execute: vi.fn(async () => {}),
    };
    const uc = new DeleteProjectGroup(
      groupRepo as ProjectGroupRepository,
      projectRepo as ProjectRepository,
      deleteProject as unknown as DeleteProject,
    );
    await uc.execute({ id: "g1" });
    expect(groupRepo.delete).toHaveBeenCalledWith("g1");
    expect(deleteProject.execute).not.toHaveBeenCalled();
  });
});
