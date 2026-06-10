import { describe, expect, it } from "vitest";
import type { BeadsDependency, BeadsIssue } from "@/types/beads";

import { computeEpicProgress } from "../BeadsSidebar";

function makeIssue(overrides: Partial<BeadsIssue> = {}): BeadsIssue {
  return {
    id: "rd-child1",
    title: "Child issue",
    description: "",
    status: "open",
    priority: 2,
    issueType: "task",
    assignee: null,
    owner: null,
    createdAt: new Date("2026-06-01T12:00:00Z"),
    createdBy: null,
    updatedAt: new Date("2026-06-01T12:00:00Z"),
    closedAt: null,
    closeReason: null,
    design: "",
    acceptanceCriteria: "",
    notes: "",
    metadata: {},
    labels: [],
    dependencies: [],
    dependents: [],
    parents: [],
    children: [],
    ...overrides,
  };
}

/** A structural child link as it appears in an epic's `children` array. */
function makeChildLink(
  childId: string,
  type: string = "parent-child"
): BeadsDependency {
  return {
    issueId: childId,
    dependsOnId: "rd-epic1",
    type,
    createdAt: new Date("2026-06-01T12:00:00Z"),
    createdBy: "bd",
  };
}

function toMap(issues: BeadsIssue[]): Map<string, BeadsIssue> {
  return new Map(issues.map((i) => [i.id, i]));
}

describe("computeEpicProgress", () => {
  it("returns zero progress for an epic with no child links", () => {
    expect(computeEpicProgress([], toMap([]))).toEqual({ closed: 0, total: 0 });
  });

  it("dedupes duplicate child-of + parent-child links for the same child", () => {
    const children = [
      makeChildLink("rd-a", "parent-child"),
      makeChildLink("rd-a", "child-of"),
      makeChildLink("rd-b", "parent-child"),
    ];
    const issueMap = toMap([
      makeIssue({ id: "rd-a", status: "closed" }),
      makeIssue({ id: "rd-b", status: "open" }),
    ]);

    expect(computeEpicProgress(children, issueMap)).toEqual({
      closed: 1,
      total: 2,
    });
  });

  it("counts loaded-closed children but not loaded-open ones", () => {
    const children = [
      makeChildLink("rd-closed"),
      makeChildLink("rd-open"),
      makeChildLink("rd-wip"),
    ];
    const issueMap = toMap([
      makeIssue({ id: "rd-closed", status: "closed" }),
      makeIssue({ id: "rd-open", status: "open" }),
      makeIssue({ id: "rd-wip", status: "in_progress" }),
    ]);

    expect(computeEpicProgress(children, issueMap)).toEqual({
      closed: 1,
      total: 3,
    });
  });

  it("counts children missing from issueMap as closed (retention-pruned)", () => {
    // The epic-children augmentation always loads non-closed children, so a
    // not-loaded child can only be a retention-pruned closed issue.
    const children = [
      makeChildLink("rd-pruned1"),
      makeChildLink("rd-pruned2"),
      makeChildLink("rd-open"),
    ];
    const issueMap = toMap([makeIssue({ id: "rd-open", status: "open" })]);

    expect(computeEpicProgress(children, issueMap)).toEqual({
      closed: 2,
      total: 3,
    });
  });

  it("combines loaded-closed, open, and pruned-closed children (jvcx repro)", () => {
    // 7 loaded-closed + 2 open + 8 pruned-closed = 15/17 complete; the chip
    // previously rendered 7/17 because pruned children never counted.
    const loadedClosed = Array.from({ length: 7 }, (_, i) =>
      makeIssue({ id: `rd-closed${i}`, status: "closed" })
    );
    const open = Array.from({ length: 2 }, (_, i) =>
      makeIssue({ id: `rd-open${i}`, status: "open" })
    );
    const children = [
      ...loadedClosed.map((issue) => makeChildLink(issue.id)),
      ...open.map((issue) => makeChildLink(issue.id)),
      ...Array.from({ length: 8 }, (_, i) => makeChildLink(`rd-pruned${i}`)),
    ];

    expect(
      computeEpicProgress(children, toMap([...loadedClosed, ...open]))
    ).toEqual({ closed: 15, total: 17 });
  });
});
