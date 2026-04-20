import { describe, it, expect } from "vitest";
import { ProjectGroup } from "@/domain/entities/ProjectGroup";
import { ProjectHierarchyError } from "@/domain/errors/ProjectHierarchyError";

describe("ProjectGroup", () => {
  const base = {
    id: "g1",
    userId: "u1",
    name: "My Group",
    parentGroupId: null as string | null,
    collapsed: false,
    sortOrder: 0,
    legacyFolderId: null as string | null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("creates a group with defaults", () => {
    const g = ProjectGroup.create(base);
    expect(g.id).toBe("g1");
    expect(g.name).toBe("My Group");
    expect(g.parentGroupId).toBeNull();
  });

  it("rejects empty name", () => {
    expect(() => ProjectGroup.create({ ...base, name: "" })).toThrow();
  });

  it("rejects empty userId", () => {
    expect(() => ProjectGroup.create({ ...base, userId: "" })).toThrow(
      ProjectHierarchyError
    );
  });

  it("rename returns new instance", () => {
    const g = ProjectGroup.create(base);
    const renamed = g.rename("Renamed");
    expect(renamed.name).toBe("Renamed");
    expect(g.name).toBe("My Group");
  });

  it("moveUnder returns new instance with new parent", () => {
    const g = ProjectGroup.create(base);
    const moved = g.moveUnder("newParent");
    expect(moved.parentGroupId).toBe("newParent");
    expect(g.parentGroupId).toBeNull();
  });

  it("moveUnder rejects self-parenting", () => {
    const g = ProjectGroup.create(base);
    expect(() => g.moveUnder("g1")).toThrow(ProjectHierarchyError);
  });
});
