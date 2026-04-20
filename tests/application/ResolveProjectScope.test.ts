import { describe, it, expect, vi } from "vitest";
import { ResolveProjectScope } from "@/application/use-cases/project/ResolveProjectScope";
import { NodeRef } from "@/domain/value-objects/NodeRef";

describe("ResolveProjectScope", () => {
  it("returns the project id itself when given a project ref", async () => {
    const groupRepo: any = { listDescendantGroupIds: vi.fn() };
    const projectRepo: any = { listByGroupIds: vi.fn() };
    const uc = new ResolveProjectScope(groupRepo, projectRepo);
    const ids = await uc.execute(NodeRef.project("p1"));
    expect(ids).toEqual(["p1"]);
    expect(groupRepo.listDescendantGroupIds).not.toHaveBeenCalled();
  });

  it("returns descendant project ids when given a group ref", async () => {
    const groupRepo: any = {
      listDescendantGroupIds: vi.fn().mockResolvedValue(["g2", "g3"]),
    };
    const projectRepo: any = {
      listByGroupIds: vi.fn().mockResolvedValue([
        { id: "p1" },
        { id: "p2" },
        { id: "p3" },
      ]),
    };
    const uc = new ResolveProjectScope(groupRepo, projectRepo);
    const ids = await uc.execute(NodeRef.group("g1"));
    expect(ids.sort()).toEqual(["p1", "p2", "p3"]);
    expect(groupRepo.listDescendantGroupIds).toHaveBeenCalledWith("g1");
    expect(projectRepo.listByGroupIds).toHaveBeenCalledWith(["g1", "g2", "g3"]);
  });
});
