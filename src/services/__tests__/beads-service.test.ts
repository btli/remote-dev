import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  classifyDependency,
  groupDependencies,
  getIssue,
  getIssues,
  getStats,
  BLOCKING_DEP_TYPES,
  STRUCTURAL_DEP_TYPES,
} from "../beads-service";
import { hasActiveBlockers, type BeadsDependency } from "@/types/beads";

// Mock the dolt query layer so getIssues/getIssue/getStats are deterministic.
type QueryCall = { sql: string; params: (string | number | null)[] };
const queryCalls: QueryCall[] = [];
let queryDispatch: (sql: string, params: (string | number | null)[]) => unknown[] = () => [];

vi.mock("@/lib/beads-db", () => ({
  beadsQuery: vi.fn(
    async (_path: string, sql: string, params: (string | number | null)[] = []) => {
      queryCalls.push({ sql, params });
      return queryDispatch(sql, params);
    }
  ),
}));

function dep(issueId: string, dependsOnId: string, type: string): BeadsDependency {
  return { issueId, dependsOnId, type, createdAt: new Date(0), createdBy: "" };
}

/** Minimal dolt `issues` row for the service mappers. */
function issueRow(overrides: { id: string; status?: string; issue_type?: string; closed_at?: Date | null }) {
  return {
    id: overrides.id,
    title: overrides.id,
    description: null,
    design: null,
    acceptance_criteria: null,
    notes: null,
    status: overrides.status ?? "open",
    priority: 2,
    issue_type: overrides.issue_type ?? "task",
    assignee: null,
    owner: null,
    created_at: new Date(0),
    created_by: null,
    updated_at: new Date(0),
    closed_at: overrides.closed_at ?? null,
    close_reason: null,
    metadata: null,
  };
}

/** Minimal dolt `dependencies` row. */
function depRow(issueId: string, dependsOnId: string, type: string) {
  return {
    issue_id: issueId,
    depends_on_issue_id: dependsOnId,
    type,
    created_at: new Date(0),
    created_by: null,
  };
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

describe("getStats", () => {
  beforeEach(() => {
    queryCalls.length = 0;
    queryDispatch = () => [];
  });

  it("computes ready via dedicated SQL and blocked from status + active blockers", async () => {
    queryDispatch = (sql) => {
      if (sql.includes("GROUP BY status")) {
        return [
          { status: "open", cnt: 5 },
          { status: "in_progress", cnt: 2 },
          { status: "blocked", cnt: 3 },
          { status: "closed", cnt: 4 },
          { status: "deferred", cnt: 1 },
        ];
      }
      // Check NOT EXISTS (ready) before EXISTS (blocked) — both contain "EXISTS".
      if (sql.includes("NOT EXISTS")) return [{ cnt: 2 }];
      if (sql.includes("EXISTS")) return [{ cnt: 6 }];
      return [];
    };

    const stats = await getStats("/proj");

    // total = sum of all status counts, including stored 'blocked' rows
    expect(stats.total).toBe(15);
    // open = literal status='open' count only
    expect(stats.open).toBe(5);
    expect(stats.inProgress).toBe(2);
    expect(stats.closed).toBe(4);
    expect(stats.deferred).toBe(1);
    // ready comes straight from the dedicated query, NOT open - blocked
    expect(stats.ready).toBe(2);
    expect(stats.blocked).toBe(6);
    expect(stats.ready).not.toBe(Math.max(0, stats.open - stats.blocked));
  });

  it("ready SQL counts open issues without an active (non-closed) blocker", async () => {
    await getStats("/proj");

    const readyCall = queryCalls.find((c) => c.sql.includes("NOT EXISTS"));
    expect(readyCall).toBeDefined();
    expect(readyCall!.sql).toContain("i.status = 'open'");
    expect(readyCall!.sql).toContain("b.status != 'closed'");
    expect(readyCall!.params).toEqual([...BLOCKING_DEP_TYPES]);
  });

  it("blocked SQL counts non-closed issues with stored blocked status OR an active blocker", async () => {
    await getStats("/proj");

    const blockedCall = queryCalls.find((c) => c.sql.includes("i.status = 'blocked'"));
    expect(blockedCall).toBeDefined();
    expect(blockedCall!.sql).toContain("COUNT(DISTINCT i.id)");
    expect(blockedCall!.sql).toContain("i.status != 'closed'");
    expect(blockedCall!.sql).toContain("b.status != 'closed'");
    expect(blockedCall!.params).toEqual([...BLOCKING_DEP_TYPES]);
  });

  it("returns zeroed stats for an empty database", async () => {
    const stats = await getStats("/proj");
    expect(stats).toEqual({
      total: 0,
      open: 0,
      inProgress: 0,
      closed: 0,
      blocked: 0,
      ready: 0,
      deferred: 0,
    });
  });
});

describe("getIssues epic-children retention", () => {
  beforeEach(() => {
    queryCalls.length = 0;
    queryDispatch = () => [];
  });

  it("applies the default retention predicate to the epic-children fetch", async () => {
    queryDispatch = (sql) => {
      if (sql.startsWith("SELECT * FROM issues WHERE (")) {
        return [issueRow({ id: "epic-1", issue_type: "epic" })];
      }
      if (sql.includes("FROM dependencies WHERE type IN")) {
        return [depRow("child-1", "epic-1", "parent-child")];
      }
      // Child fetch returns nothing — the child closed outside the window.
      return [];
    };

    const issues = await getIssues("/proj");

    const childCall = queryCalls.find((c) =>
      c.sql.startsWith("SELECT * FROM issues WHERE id IN")
    );
    expect(childCall).toBeDefined();
    expect(childCall!.sql).toContain(
      "AND (status != 'closed' OR closed_at >= ? OR issue_type = 'epic')"
    );
    // params = child id + retention cutoff (same cutoff as the main query)
    const mainCall = queryCalls[0];
    expect(childCall!.params).toEqual(["child-1", mainCall.params[0]]);

    // Ancient closed child stays excluded
    expect(issues.map((i) => i.id)).toEqual(["epic-1"]);
  });

  it("keeps the explicit status filter (no retention predicate) when status is set", async () => {
    queryDispatch = (sql) => {
      if (sql.startsWith("SELECT * FROM issues WHERE status = ?")) {
        return [issueRow({ id: "epic-1", issue_type: "epic", status: "closed" })];
      }
      if (sql.includes("FROM dependencies WHERE type IN")) {
        return [depRow("child-1", "epic-1", "parent-child")];
      }
      return [];
    };

    await getIssues("/proj", { status: "closed" });

    const childCall = queryCalls.find((c) =>
      c.sql.startsWith("SELECT * FROM issues WHERE id IN")
    );
    expect(childCall).toBeDefined();
    expect(childCall!.sql).toContain("AND status = ?");
    expect(childCall!.sql).not.toContain("closed_at >= ?");
    expect(childCall!.params).toEqual(["child-1", "closed"]);
  });
});

describe("getIssues dependsOnStatus population", () => {
  beforeEach(() => {
    queryCalls.length = 0;
    queryDispatch = () => [];
  });

  it("populates dependsOnStatus from in-set issues and a lookup for out-of-set blockers", async () => {
    queryDispatch = (sql) => {
      if (sql.startsWith("SELECT * FROM issues WHERE (")) {
        return [
          issueRow({ id: "a" }),
          issueRow({ id: "b" }),
          issueRow({ id: "d" }),
        ];
      }
      if (sql.includes("FROM dependencies WHERE issue_id IN")) {
        return [
          depRow("a", "b", "blocks"),
          depRow("a", "c", "blocks"),
          depRow("d", "c", "blocks"),
        ];
      }
      if (sql.startsWith("SELECT id, status FROM issues WHERE id IN")) {
        // "c" closed long ago — outside the fetched set
        return [{ id: "c", status: "closed" }];
      }
      return [];
    };

    const issues = await getIssues("/proj");
    const byId = new Map(issues.map((i) => [i.id, i]));

    // Out-of-set blocker statuses are fetched exactly once for the missing ids
    const statusCall = queryCalls.find((c) =>
      c.sql.startsWith("SELECT id, status FROM issues WHERE id IN")
    );
    expect(statusCall).toBeDefined();
    expect(statusCall!.params).toEqual(["c"]);

    const a = byId.get("a")!;
    expect(a.dependencies).toHaveLength(2);
    const aDepB = a.dependencies.find((depLink) => depLink.dependsOnId === "b")!;
    const aDepC = a.dependencies.find((depLink) => depLink.dependsOnId === "c")!;
    expect(aDepB.dependsOnStatus).toBe("open"); // in-set blocker
    expect(aDepC.dependsOnStatus).toBe("closed"); // looked-up blocker

    // dependents links carry the target's status too
    const b = byId.get("b")!;
    expect(b.dependents).toHaveLength(1);
    expect(b.dependents[0].dependsOnStatus).toBe("open");

    // Core correctness: stale dep rows with a closed blocker do NOT block
    const d = byId.get("d")!;
    expect(d.dependencies).toHaveLength(1);
    expect(d.dependencies[0].dependsOnStatus).toBe("closed");
    expect(hasActiveBlockers(d)).toBe(false);
    expect(hasActiveBlockers(a)).toBe(true);
  });
});

describe("getIssue dependsOnStatus population", () => {
  beforeEach(() => {
    queryCalls.length = 0;
    queryDispatch = () => [];
  });

  it("resolves out-of-set blocker statuses for a single issue", async () => {
    queryDispatch = (sql) => {
      if (sql.startsWith("SELECT * FROM issues WHERE id = ?")) {
        return [issueRow({ id: "a" })];
      }
      if (sql.includes("FROM dependencies WHERE issue_id = ?")) {
        return [depRow("a", "c", "blocks")];
      }
      if (sql.startsWith("SELECT id, status FROM issues WHERE id IN")) {
        return [{ id: "c", status: "closed" }];
      }
      return [];
    };

    const issue = await getIssue("/proj", "a");

    expect(issue).not.toBeNull();
    expect(issue!.dependencies).toHaveLength(1);
    expect(issue!.dependencies[0].dependsOnStatus).toBe("closed");
    expect(hasActiveBlockers(issue!)).toBe(false);
  });
});
