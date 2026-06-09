import { describe, it, expect } from "vitest";
import {
  isActiveBlocker,
  hasActiveBlockers,
  type BeadsDependency,
  type BeadsIssue,
  type BeadsStatus,
} from "../beads";

function dep(dependsOnStatus?: BeadsStatus | null): BeadsDependency {
  return {
    issueId: "a",
    dependsOnId: "b",
    type: "blocks",
    createdAt: new Date(0),
    createdBy: "",
    ...(dependsOnStatus !== undefined ? { dependsOnStatus } : {}),
  };
}

function issue(dependencies: BeadsDependency[]): BeadsIssue {
  return {
    id: "a",
    title: "a",
    description: "",
    status: "open",
    priority: 2,
    issueType: "task",
    assignee: null,
    owner: null,
    createdAt: new Date(0),
    createdBy: null,
    updatedAt: new Date(0),
    closedAt: null,
    closeReason: null,
    design: "",
    acceptanceCriteria: "",
    notes: "",
    metadata: {},
    labels: [],
    dependencies,
    dependents: [],
    parents: [],
    children: [],
  };
}

describe("isActiveBlocker", () => {
  it("treats a closed blocker as inactive", () => {
    expect(isActiveBlocker(dep("closed"))).toBe(false);
  });

  it("treats open / in_progress / blocked / deferred blockers as active", () => {
    expect(isActiveBlocker(dep("open"))).toBe(true);
    expect(isActiveBlocker(dep("in_progress"))).toBe(true);
    expect(isActiveBlocker(dep("blocked"))).toBe(true);
    expect(isActiveBlocker(dep("deferred"))).toBe(true);
  });

  it("treats an unknown blocker status as active (conservative)", () => {
    expect(isActiveBlocker(dep())).toBe(true);
    expect(isActiveBlocker(dep(null))).toBe(true);
  });
});

describe("hasActiveBlockers", () => {
  it("returns false for an issue with no blocking deps", () => {
    expect(hasActiveBlockers(issue([]))).toBe(false);
  });

  it("returns false when every blocker is closed (stale dep rows)", () => {
    expect(hasActiveBlockers(issue([dep("closed"), dep("closed")]))).toBe(false);
  });

  it("returns true when at least one blocker is still active", () => {
    expect(hasActiveBlockers(issue([dep("closed"), dep("open")]))).toBe(true);
  });

  it("returns true when a blocker status is unknown", () => {
    expect(hasActiveBlockers(issue([dep()]))).toBe(true);
  });
});
