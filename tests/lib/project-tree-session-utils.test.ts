import { describe, it, expect } from "vitest";
import {
  sessionsForProject,
  recursiveSessionCount,
  rolledUpRepoStats,
} from "@/lib/project-tree-session-utils";

const sessions = [
  { id: "s1", projectId: "p1" },
  { id: "s2", projectId: "p1", terminalType: "file" },
  { id: "s3", projectId: "p2" },
  { id: "s4", projectId: null },
];

const groups = [
  { id: "g1", parentGroupId: null, name: "g1", collapsed: false, sortOrder: 0 },
  { id: "g2", parentGroupId: "g1", name: "g2", collapsed: false, sortOrder: 0 },
];
const projects = [
  { id: "p1", groupId: "g1", name: "p1", isAutoCreated: false, sortOrder: 0 },
  { id: "p2", groupId: "g2", name: "p2", isAutoCreated: false, sortOrder: 0 },
];

describe("sessionsForProject", () => {
  it("returns every session whose projectId matches", () => {
    expect(sessionsForProject(sessions, "p1").map((s) => s.id)).toEqual(["s1", "s2"]);
  });
  it("excludes file sessions when opt set", () => {
    expect(
      sessionsForProject(sessions, "p1", { excludeFileSessions: true }).map((s) => s.id)
    ).toEqual(["s1"]);
  });
  it("returns [] when project has no sessions", () => {
    expect(sessionsForProject(sessions, "p3")).toEqual([]);
  });
});

describe("recursiveSessionCount", () => {
  it("counts sessions in own projects plus descendant groups' projects", () => {
    // g1 owns p1 (1 non-file session: s1); descendant g2 owns p2 (1 session: s3) => 2
    expect(recursiveSessionCount(sessions, groups, projects, "g1")).toBe(2);
  });
  it("excludes file sessions from the count", () => {
    const onlyFile = [{ id: "s", projectId: "p1", terminalType: "file" }];
    expect(recursiveSessionCount(onlyFile, groups, projects, "g1")).toBe(0);
  });
  it("returns 0 for an empty leaf group", () => {
    const leafGroups = [{ id: "leaf", parentGroupId: null, name: "leaf", collapsed: false, sortOrder: 0 }];
    expect(recursiveSessionCount(sessions, leafGroups, [], "leaf")).toBe(0);
  });
});

describe("rolledUpRepoStats", () => {
  const groups = [
    { id: "g1", parentGroupId: null, name: "g1", collapsed: true, sortOrder: 0 },
    { id: "g2", parentGroupId: "g1", name: "g2", collapsed: false, sortOrder: 0 },
  ];
  const projects = [
    { id: "p1", groupId: "g1", name: "p1", isAutoCreated: false, sortOrder: 0 },
    { id: "p2", groupId: "g2", name: "p2", isAutoCreated: false, sortOrder: 0 },
  ];

  it("returns the project's own stats for project nodes", () => {
    const getStats = (pid: string) =>
      pid === "p1" ? { prCount: 1, issueCount: 2, hasChanges: false } : null;
    expect(rolledUpRepoStats(groups, projects, getStats, { type: "project", id: "p1" })).toEqual({
      prCount: 1,
      issueCount: 2,
      hasChanges: false,
    });
  });

  it("returns null for expanded groups (children render their own)", () => {
    const getStats = () => ({ prCount: 1, issueCount: 0, hasChanges: false });
    expect(
      rolledUpRepoStats(groups, projects, getStats, { type: "group", id: "g1", collapsed: false })
    ).toBeNull();
  });

  it("aggregates descendant project stats for collapsed groups", () => {
    const getStats = (pid: string) =>
      pid === "p1"
        ? { prCount: 2, issueCount: 1, hasChanges: true }
        : pid === "p2"
        ? { prCount: 1, issueCount: 0, hasChanges: false }
        : null;
    expect(
      rolledUpRepoStats(groups, projects, getStats, { type: "group", id: "g1", collapsed: true })
    ).toEqual({ prCount: 3, issueCount: 1, hasChanges: true });
  });

  it("returns null when a collapsed group has no stats in its descendants", () => {
    const getStats = () => null;
    expect(
      rolledUpRepoStats(groups, projects, getStats, { type: "group", id: "g1", collapsed: true })
    ).toBeNull();
  });

  it("returns null when all aggregated stats are zero/false", () => {
    const getStats = () => ({ prCount: 0, issueCount: 0, hasChanges: false });
    expect(
      rolledUpRepoStats(groups, projects, getStats, { type: "group", id: "g1", collapsed: true })
    ).toBeNull();
  });
});
