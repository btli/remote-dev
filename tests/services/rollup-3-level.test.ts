import { describe, it, expect, vi } from "vitest";
import { ResolveProjectScope } from "@/application/use-cases/project/ResolveProjectScope";
import { NodeRef } from "@/domain/value-objects/NodeRef";

/**
 * Phase 3 smoke test: rollup across a 3-level group hierarchy.
 *
 * Group tree:
 *   root (g1)
 *   ├── child (g2)
 *   │   └── grandchild (g3)  — owns project p3
 *   └── child2 (g4)          — owns project p4
 *
 * Resolving from the root must return ALL descendant projects (p3, p4).
 * Uses mocked repositories to avoid the tmpdir SQLite harness.
 */
describe("ResolveProjectScope — 3-level rollup", () => {
  it("collects projects from every descendant group", async () => {
    const groupRepo: any = {
      listDescendantGroupIds: vi.fn().mockResolvedValue([
        "g2",
        "g3",
        "g4",
      ]),
    };
    const projectRepo: any = {
      listByGroupIds: vi.fn().mockResolvedValue([
        { id: "p3", groupId: "g3" },
        { id: "p4", groupId: "g4" },
      ]),
    };

    const uc = new ResolveProjectScope(groupRepo, projectRepo);
    const ids = await uc.execute(NodeRef.group("g1"));

    expect(ids.sort()).toEqual(["p3", "p4"]);
    expect(groupRepo.listDescendantGroupIds).toHaveBeenCalledWith("g1");
    // Must include the starting group itself so projects directly under g1
    // are not dropped.
    expect(projectRepo.listByGroupIds).toHaveBeenCalledWith([
      "g1",
      "g2",
      "g3",
      "g4",
    ]);
  });

  it("returns a direct project id without walking groups", async () => {
    const groupRepo: any = { listDescendantGroupIds: vi.fn() };
    const projectRepo: any = { listByGroupIds: vi.fn() };
    const uc = new ResolveProjectScope(groupRepo, projectRepo);
    const ids = await uc.execute(NodeRef.project("p-direct"));
    expect(ids).toEqual(["p-direct"]);
    expect(groupRepo.listDescendantGroupIds).not.toHaveBeenCalled();
    expect(projectRepo.listByGroupIds).not.toHaveBeenCalled();
  });
});
