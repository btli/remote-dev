import { describe, it, expect } from "vitest";
import {
  classifyDependency,
  groupDependencies,
  BLOCKING_DEP_TYPES,
  STRUCTURAL_DEP_TYPES,
} from "../beads-service";
import type { BeadsDependency } from "@/types/beads";

function dep(issueId: string, dependsOnId: string, type: string): BeadsDependency {
  return { issueId, dependsOnId, type, createdAt: new Date(0), createdBy: "" };
}

describe("classifyDependency", () => {
  it('classifies "blocks" as blocking', () => {
    expect(classifyDependency("blocks")).toBe("blocking");
  });

  it('classifies "parent-child" as structural', () => {
    expect(classifyDependency("parent-child")).toBe("structural");
  });

  it('classifies "child-of" as structural', () => {
    expect(classifyDependency("child-of")).toBe("structural");
  });

  it('classifies "relates-to" as other', () => {
    expect(classifyDependency("relates-to")).toBe("other");
  });

  it('classifies "discovered-from" as other', () => {
    expect(classifyDependency("discovered-from")).toBe("other");
  });

  it('classifies unknown types as other', () => {
    expect(classifyDependency("unknown")).toBe("other");
  });
});

describe("BLOCKING_DEP_TYPES and STRUCTURAL_DEP_TYPES", () => {
  it("BLOCKING_DEP_TYPES contains only blocks", () => {
    expect(BLOCKING_DEP_TYPES.has("blocks")).toBe(true);
    expect(BLOCKING_DEP_TYPES.size).toBe(1);
  });

  it("STRUCTURAL_DEP_TYPES contains parent-child and child-of", () => {
    expect(STRUCTURAL_DEP_TYPES.has("parent-child")).toBe(true);
    expect(STRUCTURAL_DEP_TYPES.has("child-of")).toBe(true);
    expect(STRUCTURAL_DEP_TYPES.size).toBe(2);
  });
});

describe("groupDependencies", () => {
  it("routes a blocks link into dependencies and dependents only", () => {
    const link = dep("child", "blocker", "blocks");
    const result = groupDependencies([link]);

    expect(result.dependencies.get("child")).toHaveLength(1);
    expect(result.dependents.get("blocker")).toHaveLength(1);
    expect(result.parents.size).toBe(0);
    expect(result.children.size).toBe(0);
  });

  it("regression: parent-child link does NOT appear in dependencies (child stays Ready)", () => {
    const link = dep("child", "epic", "parent-child");
    const result = groupDependencies([link]);

    expect(result.dependencies.get("child")).toBeUndefined();
    expect(result.parents.get("child")).toHaveLength(1);
    expect(result.parents.get("child")![0].dependsOnId).toBe("epic");
    expect(result.children.get("epic")).toHaveLength(1);
    expect(result.children.get("epic")![0].issueId).toBe("child");
    // dependents map must also be empty for this link
    expect(result.dependents.size).toBe(0);
  });

  it("regression: child-of link does NOT appear in dependencies (child stays Ready)", () => {
    const link = dep("child", "epic", "child-of");
    const result = groupDependencies([link]);

    expect(result.dependencies.get("child")).toBeUndefined();
    expect(result.parents.get("child")).toHaveLength(1);
    expect(result.parents.get("child")![0].dependsOnId).toBe("epic");
    expect(result.children.get("epic")).toHaveLength(1);
    expect(result.children.get("epic")![0].issueId).toBe("child");
    expect(result.dependents.size).toBe(0);
  });

  it("excludes relates-to links from all maps", () => {
    const result = groupDependencies([dep("a", "b", "relates-to")]);
    expect(result.dependencies.size).toBe(0);
    expect(result.dependents.size).toBe(0);
    expect(result.parents.size).toBe(0);
    expect(result.children.size).toBe(0);
  });

  it("excludes discovered-from links from all maps", () => {
    const result = groupDependencies([dep("a", "b", "discovered-from")]);
    expect(result.dependencies.size).toBe(0);
    expect(result.dependents.size).toBe(0);
    expect(result.parents.size).toBe(0);
    expect(result.children.size).toBe(0);
  });

  it("correctly handles a mix of blocks and parent-child for the same child issue", () => {
    const links = [
      dep("child", "blocker", "blocks"),
      dep("child", "epic", "parent-child"),
    ];
    const result = groupDependencies(links);

    // Only the blocks link lands in dependencies
    expect(result.dependencies.get("child")).toHaveLength(1);
    expect(result.dependencies.get("child")![0].dependsOnId).toBe("blocker");

    // The parent-child link lands in parents only
    expect(result.parents.get("child")).toHaveLength(1);
    expect(result.parents.get("child")![0].dependsOnId).toBe("epic");

    // dependents keyed by blocker
    expect(result.dependents.get("blocker")).toHaveLength(1);

    // children keyed by epic
    expect(result.children.get("epic")).toHaveLength(1);
  });
});
