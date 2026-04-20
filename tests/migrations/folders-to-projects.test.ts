import { describe, it, expect } from "vitest";
import {
  classifyFolders,
  planDefaultProjects,
  planWorkspaceGroup,
  type FolderRow,
} from "../../scripts/migrate-folders-to-projects";

interface Folder {
  id: string;
  userId: string;
  parentId: string | null;
  name: string;
}

describe("classifyFolders", () => {
  it("classifies a leaf folder as project", () => {
    const folders: Folder[] = [
      { id: "f1", userId: "u1", parentId: null, name: "App" },
    ];
    const { groupIds, projectIds } = classifyFolders(folders);
    expect(projectIds).toContain("f1");
    expect(groupIds).not.toContain("f1");
  });

  it("classifies a parent folder with children as group", () => {
    const folders: Folder[] = [
      { id: "f1", userId: "u1", parentId: null, name: "Parent" },
      { id: "f2", userId: "u1", parentId: "f1", name: "Child" },
    ];
    const { groupIds, projectIds } = classifyFolders(folders);
    expect(groupIds).toContain("f1");
    expect(projectIds).toContain("f2");
  });

  it("handles multi-level nesting", () => {
    const folders: Folder[] = [
      { id: "g1", userId: "u1", parentId: null, name: "Root" },
      { id: "g2", userId: "u1", parentId: "g1", name: "Mid" },
      { id: "p1", userId: "u1", parentId: "g2", name: "Leaf" },
    ];
    const { groupIds, projectIds } = classifyFolders(folders);
    expect(groupIds).toEqual(expect.arrayContaining(["g1", "g2"]));
    expect(projectIds).toEqual(["p1"]);
  });
});

describe("planDefaultProjects", () => {
  it("plans Default project when group has direct sessions", () => {
    const groupIds = new Set(["g1"]);
    const directCounts = new Map([["g1", 3]]);
    const plan = planDefaultProjects(groupIds, directCounts);
    expect(plan.has("g1")).toBe(true);
  });

  it("skips groups with no direct contents", () => {
    const groupIds = new Set(["g1"]);
    const directCounts = new Map<string, number>();
    const plan = planDefaultProjects(groupIds, directCounts);
    expect(plan.size).toBe(0);
  });
});

describe("planWorkspaceGroup", () => {
  it("creates one Workspace per user when root leaves exist", () => {
    const rootLeaves: FolderRow[] = [
      { id: "p1", userId: "u1", parentId: null, name: "App" },
      { id: "p2", userId: "u1", parentId: null, name: "Scripts" },
      { id: "p3", userId: "u2", parentId: null, name: "Other" },
    ];
    const plan = planWorkspaceGroup(rootLeaves);
    expect(plan.size).toBe(2);
    expect(plan.get("u1")).toBeDefined();
    expect(plan.get("u2")).toBeDefined();
  });

  it("returns empty when no root leaves exist", () => {
    const plan = planWorkspaceGroup([]);
    expect(plan.size).toBe(0);
  });
});
