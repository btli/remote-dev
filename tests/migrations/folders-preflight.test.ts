import { describe, it, expect } from "vitest";
import { validateFolderGraph } from "../../scripts/migrate-folders-to-projects";

interface Folder {
  id: string;
  userId: string;
  parentId: string | null;
  name: string;
}

describe("validateFolderGraph", () => {
  it("accepts a clean tree", () => {
    const folders: Folder[] = [
      { id: "a", userId: "u1", parentId: null, name: "Root" },
      { id: "b", userId: "u1", parentId: "a", name: "Child" },
    ];
    expect(() => validateFolderGraph(folders)).not.toThrow();
  });

  it("rejects a cycle", () => {
    const folders: Folder[] = [
      { id: "a", userId: "u1", parentId: "b", name: "A" },
      { id: "b", userId: "u1", parentId: "a", name: "B" },
    ];
    expect(() => validateFolderGraph(folders)).toThrow(/cycle/i);
  });

  it("rejects an orphan parent reference", () => {
    const folders: Folder[] = [
      { id: "a", userId: "u1", parentId: "missing", name: "A" },
    ];
    expect(() => validateFolderGraph(folders)).toThrow(/orphan/i);
  });

  it("rejects a cross-user parent reference", () => {
    const folders: Folder[] = [
      { id: "a", userId: "u1", parentId: null, name: "A" },
      { id: "b", userId: "u2", parentId: "a", name: "B" },
    ];
    expect(() => validateFolderGraph(folders)).toThrow(/cross-user/i);
  });
});
