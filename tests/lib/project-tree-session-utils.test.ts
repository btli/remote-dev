import { describe, it, expect } from "vitest";
import {
  sessionsForProject,
  recursiveSessionCount,
  rolledUpRepoStats,
  globalSessions,
} from "@/lib/project-tree-session-utils";
import {
  GLOBAL_TERMINAL_TYPES,
  isGlobalTerminalType,
} from "@/types/terminal-type";

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
  { id: "p1", groupId: "g1", name: "p1", isAutoCreated: false, sortOrder: 0, collapsed: false },
  { id: "p2", groupId: "g2", name: "p2", isAutoCreated: false, sortOrder: 0, collapsed: false },
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
    { id: "p1", groupId: "g1", name: "p1", isAutoCreated: false, sortOrder: 0, collapsed: false },
    { id: "p2", groupId: "g2", name: "p2", isAutoCreated: false, sortOrder: 0, collapsed: false },
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

describe("isGlobalTerminalType", () => {
  it("returns true for each GLOBAL_TERMINAL_TYPES entry", () => {
    for (const t of GLOBAL_TERMINAL_TYPES) {
      expect(isGlobalTerminalType(t)).toBe(true);
    }
  });
  it("returns false for non-global types", () => {
    expect(isGlobalTerminalType("shell")).toBe(false);
    expect(isGlobalTerminalType("agent")).toBe(false);
    expect(isGlobalTerminalType("file")).toBe(false);
    expect(isGlobalTerminalType("browser")).toBe(false);
    expect(isGlobalTerminalType("issues")).toBe(false);
    expect(isGlobalTerminalType("prs")).toBe(false);
    expect(isGlobalTerminalType("some-custom-type")).toBe(false);
  });
  it("returns false for nullish input", () => {
    expect(isGlobalTerminalType(null)).toBe(false);
    expect(isGlobalTerminalType(undefined)).toBe(false);
  });
  it("GLOBAL_TERMINAL_TYPES contains settings/recordings/profiles", () => {
    expect(new Set(GLOBAL_TERMINAL_TYPES)).toEqual(
      new Set(["settings", "recordings", "profiles"]),
    );
  });
});

describe("globalSessions + sessionsForProject interaction", () => {
  // Two "settings" sessions carrying different project_ids (the dedup path
  // shouldn't let this happen in practice, but if it did, the sidebar should
  // still render both in the Global section and NEITHER under a project).
  const mixed = [
    { id: "n1", projectId: "p1", terminalType: "shell" },
    { id: "n2", projectId: "p2", terminalType: "shell" },
    { id: "g1", projectId: "p1", terminalType: "settings" },
    { id: "g2", projectId: "p2", terminalType: "settings" },
    { id: "g3", projectId: "p1", terminalType: "recordings" },
    { id: "g4", projectId: "p1", terminalType: "profiles" },
  ];

  it("globalSessions returns every settings/recordings/profiles session", () => {
    expect(globalSessions(mixed).map((s) => s.id).sort()).toEqual([
      "g1",
      "g2",
      "g3",
      "g4",
    ]);
  });

  it("sessionsForProject excludes global-type sessions from each project", () => {
    expect(sessionsForProject(mixed, "p1").map((s) => s.id)).toEqual(["n1"]);
    expect(sessionsForProject(mixed, "p2").map((s) => s.id)).toEqual(["n2"]);
  });

  it("each global session appears exactly once across the sidebar", () => {
    const seen = new Map<string, number>();
    const bump = (id: string) => seen.set(id, (seen.get(id) ?? 0) + 1);
    for (const s of globalSessions(mixed)) bump(s.id);
    for (const pid of ["p1", "p2"]) {
      for (const s of sessionsForProject(mixed, pid)) bump(s.id);
    }
    // every global session counted once, no project leaked it
    expect(seen.get("g1")).toBe(1);
    expect(seen.get("g2")).toBe(1);
    expect(seen.get("g3")).toBe(1);
    expect(seen.get("g4")).toBe(1);
  });

  it("recursiveSessionCount excludes global sessions from project rollups", () => {
    const groups = [
      { id: "g1", parentGroupId: null, name: "g1", collapsed: false, sortOrder: 0 },
    ];
    const projects = [
      { id: "p1", groupId: "g1", name: "p1", isAutoCreated: false, sortOrder: 0, collapsed: false },
      { id: "p2", groupId: "g1", name: "p2", isAutoCreated: false, sortOrder: 0, collapsed: false },
    ];
    // Two shell sessions (n1 in p1, n2 in p2) + four global sessions spread
    // across both projects. Count should be 2 (only shell sessions).
    expect(recursiveSessionCount(mixed, groups, projects, "g1")).toBe(2);
  });
});
