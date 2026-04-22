import { describe, it, expect } from "vitest";
import { Project } from "@/domain/entities/Project";

describe("Project", () => {
  const base = {
    id: "p1",
    userId: "u1",
    groupId: "g1",
    name: "My Project",
    collapsed: false,
    sortOrder: 0,
    isAutoCreated: false,
    legacyFolderId: null as string | null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("creates project with non-null groupId", () => {
    const p = Project.create(base);
    expect(p.groupId).toBe("g1");
  });

  it("rejects missing groupId", () => {
    expect(() => Project.create({ ...base, groupId: "" })).toThrow();
  });

  it("rejects empty name", () => {
    expect(() => Project.create({ ...base, name: "  " })).toThrow();
  });

  it("moveTo changes groupId", () => {
    const p = Project.create(base);
    const moved = p.moveTo("g2");
    expect(moved.groupId).toBe("g2");
    expect(p.groupId).toBe("g1");
  });

  it("rename returns new instance", () => {
    const p = Project.create(base);
    const renamed = p.rename("New Name");
    expect(renamed.name).toBe("New Name");
  });

  it("autoCreated flag is preserved through operations", () => {
    const p = Project.create({ ...base, isAutoCreated: true });
    expect(p.isAutoCreated).toBe(true);
    expect(p.rename("other").isAutoCreated).toBe(true);
  });
});
