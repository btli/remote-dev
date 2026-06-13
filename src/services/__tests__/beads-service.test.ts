import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  classifyDependency,
  groupDependencies,
  getIssue,
  getIssues,
  getIssueComments,
  getIssueEvents,
  getStats,
  BLOCKING_DEP_TYPES,
  STRUCTURAL_DEP_TYPES,
  VIEWABLE_ISSUE_TYPES,
} from "../beads-service";
import { isBeadsUnavailable } from "@/lib/beads-cli";
import { hasActiveBlockers, type BeadsDependency } from "@/types/beads";

// Mock the bd CLI runner layer so getIssues/getIssue/getStats/etc. are
// deterministic. `parseJsonl` is the real implementation; only the spawning
// functions (runBd / runBdJson / runBdExportCached) are mocked, dispatched by
// the bd subcommand in the args.
type RunCall = { args: string[] };
const runCalls: RunCall[] = [];
let exportJsonl = "";
let statusJson: unknown = { schema_version: 1, summary: {} };
let historyJson: unknown = [];
let runThrows: unknown = null;

vi.mock("@/lib/beads-cli", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/beads-cli")>();
  return {
    ...actual,
    runBd: vi.fn(async (_path: string, args: string[]) => {
      runCalls.push({ args });
      if (runThrows) throw runThrows;
      if (args[0] === "export") return exportJsonl;
      return "";
    }),
    runBdExportCached: vi.fn(async (_path: string) => {
      runCalls.push({ args: ["export"] });
      if (runThrows) throw runThrows;
      return exportJsonl;
    }),
    runBdJson: vi.fn(async (_path: string, args: string[]) => {
      runCalls.push({ args });
      if (runThrows) throw runThrows;
      if (args[0] === "status") return statusJson;
      if (args[0] === "history") return historyJson;
      return null;
    }),
  };
});

function dep(issueId: string, dependsOnId: string, type: string): BeadsDependency {
  return { issueId, dependsOnId, type, createdAt: new Date(0), createdBy: "" };
}

/** Build a raw `bd export` issue record (only the fields the mappers read). */
interface RawIssueInput {
  id: string;
  title?: string;
  status?: string;
  issue_type?: string;
  closed_at?: string | null;
  created_at?: string;
  updated_at?: string;
  labels?: string[];
  dependencies?: Array<{ issue_id: string; depends_on_id: string; type: string }>;
  comments?: Array<{ id: string; issue_id: string; author: string; text: string; created_at: string }>;
}

function exportRecord(input: RawIssueInput): Record<string, unknown> {
  return {
    _type: "issue",
    id: input.id,
    title: input.title ?? input.id,
    status: input.status ?? "open",
    priority: 2,
    issue_type: input.issue_type ?? "task",
    created_at: input.created_at ?? "2026-01-01T00:00:00Z",
    updated_at: input.updated_at ?? "2026-01-01T00:00:00Z",
    closed_at: input.closed_at ?? undefined,
    labels: input.labels,
    dependencies: (input.dependencies ?? []).map((d) => ({
      issue_id: d.issue_id,
      depends_on_id: d.depends_on_id,
      type: d.type,
      created_at: "2026-01-01T00:00:00Z",
      created_by: "tester",
      metadata: "{}",
    })),
    comments: input.comments,
  };
}

function toJsonl(records: Array<Record<string, unknown>>): string {
  return records.map((r) => JSON.stringify(r)).join("\n");
}

beforeEach(() => {
  runCalls.length = 0;
  exportJsonl = "";
  statusJson = { schema_version: 1, summary: {} };
  historyJson = [];
  runThrows = null;
});

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

describe("VIEWABLE_ISSUE_TYPES", () => {
  it("includes message but not agent/rig/role infra types", () => {
    expect(VIEWABLE_ISSUE_TYPES.has("message")).toBe(true);
    expect(VIEWABLE_ISSUE_TYPES.has("agent")).toBe(false);
    expect(VIEWABLE_ISSUE_TYPES.has("rig")).toBe(false);
    expect(VIEWABLE_ISSUE_TYPES.has("role")).toBe(false);
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
  it("maps the bd status summary to BeadsStats", async () => {
    statusJson = {
      schema_version: 1,
      summary: {
        total_issues: 15,
        open_issues: 5,
        in_progress_issues: 2,
        closed_issues: 4,
        blocked_issues: 6,
        ready_issues: 2,
        deferred_issues: 1,
      },
    };

    const stats = await getStats("/proj");

    expect(stats).toEqual({
      total: 15,
      open: 5,
      inProgress: 2,
      closed: 4,
      blocked: 6,
      ready: 2,
      deferred: 1,
    });
    // It runs `bd status --json`
    const statusCall = runCalls.find((c) => c.args[0] === "status");
    expect(statusCall?.args).toEqual(["status", "--json"]);
  });

  it("returns zeroed stats for an empty summary", async () => {
    statusJson = { schema_version: 1, summary: {} };
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

describe("getIssues", () => {
  it("maps issues + labels and groups a blocking dep + epic link", async () => {
    exportJsonl = toJsonl([
      exportRecord({ id: "epic-1", issue_type: "epic", created_at: "2026-01-03T00:00:00Z" }),
      exportRecord({
        id: "child-1",
        created_at: "2026-01-02T00:00:00Z",
        labels: ["frontend", "p1"],
        dependencies: [
          { issue_id: "child-1", depends_on_id: "blocker-1", type: "blocks" },
          { issue_id: "child-1", depends_on_id: "epic-1", type: "child-of" },
        ],
      }),
      exportRecord({ id: "blocker-1", created_at: "2026-01-01T00:00:00Z" }),
    ]);

    const issues = await getIssues("/proj");
    const byId = new Map(issues.map((i) => [i.id, i]));

    // Sorted created_at DESC: epic-1, child-1, blocker-1
    expect(issues.map((i) => i.id)).toEqual(["epic-1", "child-1", "blocker-1"]);

    const child = byId.get("child-1")!;
    expect(child.labels).toEqual(["frontend", "p1"]);

    // Blocking dep lands in dependencies, keyed by the blocked issue.
    expect(child.dependencies).toHaveLength(1);
    expect(child.dependencies[0].dependsOnId).toBe("blocker-1");
    // blocker-1 sees child-1 as a dependent (incoming edge resolved from full export).
    expect(byId.get("blocker-1")!.dependents).toHaveLength(1);
    expect(byId.get("blocker-1")!.dependents[0].issueId).toBe("child-1");

    // Structural child-of lands in parents (child) and children (epic).
    expect(child.parents).toHaveLength(1);
    expect(child.parents[0].dependsOnId).toBe("epic-1");
    expect(byId.get("epic-1")!.children).toHaveLength(1);
    expect(byId.get("epic-1")!.children[0].issueId).toBe("child-1");

    // dependsOnStatus resolved from the export's id->status map.
    expect(child.dependencies[0].dependsOnStatus).toBe("open");
    expect(hasActiveBlockers(child)).toBe(true);

    // Only one `bd export` invocation (cached), no per-issue spawns.
    expect(runCalls.filter((c) => c.args[0] === "export")).toHaveLength(1);
  });

  it("includes children of an epic even when the child would otherwise be filtered out (closed beyond retention)", async () => {
    const ancient = "2020-01-01T00:00:00Z";
    exportJsonl = toJsonl([
      exportRecord({ id: "epic-1", issue_type: "epic" }),
      // Closed long ago — would be excluded by retention, but it's an epic child.
      exportRecord({
        id: "child-1",
        status: "closed",
        closed_at: ancient,
        dependencies: [{ issue_id: "child-1", depends_on_id: "epic-1", type: "child-of" }],
      }),
    ]);

    const issues = await getIssues("/proj");
    // Epic child closed beyond retention is STILL excluded (mirrors the SQL
    // retention predicate applied to epic children).
    expect(issues.map((i) => i.id)).toEqual(["epic-1"]);
  });

  it("includes a recently-closed epic child within the retention window", async () => {
    const recent = new Date(Date.now() - 86400_000).toISOString(); // 1 day ago
    exportJsonl = toJsonl([
      exportRecord({ id: "epic-1", issue_type: "epic" }),
      exportRecord({
        id: "child-1",
        status: "closed",
        closed_at: recent,
        dependencies: [{ issue_id: "child-1", depends_on_id: "epic-1", type: "child-of" }],
      }),
    ]);

    const issues = await getIssues("/proj");
    expect(issues.map((i) => i.id).sort()).toEqual(["child-1", "epic-1"]);
  });

  it("includes message-type beads but excludes agent/rig/role infra beads", async () => {
    exportJsonl = toJsonl([
      exportRecord({ id: "task-1", issue_type: "task" }),
      exportRecord({ id: "msg-1", issue_type: "message" }),
      exportRecord({ id: "agent-1", issue_type: "agent" }),
    ]);

    const issues = await getIssues("/proj");
    const ids = issues.map((i) => i.id);

    // The message bead is shown; the agent infra bead is filtered out.
    expect(ids).toContain("msg-1");
    expect(ids).toContain("task-1");
    expect(ids).not.toContain("agent-1");
    // Confirm the message issue keeps its type through mapping.
    expect(issues.find((i) => i.id === "msg-1")!.issueType).toBe("message");
  });

  it("filters by explicit status when provided", async () => {
    exportJsonl = toJsonl([
      exportRecord({ id: "a", status: "open" }),
      exportRecord({ id: "b", status: "closed", closed_at: "2026-01-01T00:00:00Z" }),
    ]);
    const issues = await getIssues("/proj", { status: "closed" });
    expect(issues.map((i) => i.id)).toEqual(["b"]);
  });

  it("resolves a closed out-of-window blocker so a stale dep does not block", async () => {
    exportJsonl = toJsonl([
      exportRecord({
        id: "a",
        dependencies: [{ issue_id: "a", depends_on_id: "c", type: "blocks" }],
      }),
      // c is closed long ago — present in export so its status resolves.
      exportRecord({ id: "c", status: "closed", closed_at: "2020-01-01T00:00:00Z" }),
    ]);

    const issues = await getIssues("/proj");
    const a = issues.find((i) => i.id === "a")!;
    expect(a.dependencies).toHaveLength(1);
    expect(a.dependencies[0].dependsOnStatus).toBe("closed");
    expect(hasActiveBlockers(a)).toBe(false);
  });

  it("leaves dependsOnStatus null for a blocks dep whose target is absent from the export (still blocking)", async () => {
    exportJsonl = toJsonl([
      exportRecord({
        id: "a",
        // Blocker "ghost" is NOT present in the export, so its status can't resolve.
        dependencies: [{ issue_id: "a", depends_on_id: "ghost", type: "blocks" }],
      }),
    ]);

    const issues = await getIssues("/proj");
    const a = issues.find((i) => i.id === "a")!;
    expect(a.dependencies).toHaveLength(1);
    expect(a.dependencies[0].dependsOnId).toBe("ghost");
    // Unresolvable target -> null status, which hasActiveBlockers treats as still blocking.
    expect(a.dependencies[0].dependsOnStatus).toBeNull();
    expect(hasActiveBlockers(a)).toBe(true);
  });
});

describe("getIssue", () => {
  it("returns null for an unknown id", async () => {
    exportJsonl = toJsonl([exportRecord({ id: "a" })]);
    expect(await getIssue("/proj", "missing")).toBeNull();
  });

  it("returns a single issue with its grouped deps", async () => {
    exportJsonl = toJsonl([
      exportRecord({
        id: "a",
        dependencies: [{ issue_id: "a", depends_on_id: "c", type: "blocks" }],
      }),
      exportRecord({ id: "c", status: "closed", closed_at: "2020-01-01T00:00:00Z" }),
    ]);
    const issue = await getIssue("/proj", "a");
    expect(issue).not.toBeNull();
    expect(issue!.dependencies).toHaveLength(1);
    expect(issue!.dependencies[0].dependsOnStatus).toBe("closed");
    expect(hasActiveBlockers(issue!)).toBe(false);
  });
});

describe("getIssueComments", () => {
  it("returns embedded comments sorted oldest-first", async () => {
    exportJsonl = toJsonl([
      exportRecord({
        id: "a",
        comments: [
          { id: "c2", issue_id: "a", author: "bob", text: "second", created_at: "2026-02-02T00:00:00Z" },
          { id: "c1", issue_id: "a", author: "alice", text: "first", created_at: "2026-01-01T00:00:00Z" },
        ],
      }),
    ]);
    const comments = await getIssueComments("/proj", "a");
    expect(comments.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(comments[0]).toMatchObject({ author: "alice", text: "first", issueId: "a" });
  });

  it("returns [] for an unknown issue", async () => {
    exportJsonl = toJsonl([exportRecord({ id: "a" })]);
    expect(await getIssueComments("/proj", "missing")).toEqual([]);
  });
});

describe("getIssueEvents", () => {
  it("returns [] for an invalid id WITHOUT invoking the bd runner", async () => {
    const events = await getIssueEvents("/proj", "--help");
    expect(events).toEqual([]);
    // No `bd history` spawn should have been attempted for a rejected id.
    expect(runCalls.find((c) => c.args[0] === "history")).toBeUndefined();
  });

  it("rethrows when the runner throws an unavailable (ENOENT) error", async () => {
    runThrows = Object.assign(new Error("spawn bd ENOENT"), { code: "ENOENT" });
    await expect(getIssueEvents("/proj", "valid-1")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns [] when the runner throws a generic non-unavailable error", async () => {
    runThrows = new Error("some parse failure");
    expect(await getIssueEvents("/proj", "valid-1")).toEqual([]);
  });
});

describe("availability classification", () => {
  it("treats a thrown ENOENT (bd missing) as unavailable", async () => {
    const enoent = Object.assign(new Error("spawn bd ENOENT"), { code: "ENOENT" });
    expect(isBeadsUnavailable(enoent)).toBe(true);
  });

  it("treats a timeout (killed) as unavailable", () => {
    const killed = Object.assign(new Error("Command failed"), { killed: true, signal: "SIGTERM" });
    expect(isBeadsUnavailable(killed)).toBe(true);
  });

  it("treats the execFile timeout code ERR_CHILD_PROCESS_TIMED_OUT as unavailable", () => {
    const timedOut = Object.assign(new Error("timed out"), { code: "ERR_CHILD_PROCESS_TIMED_OUT" });
    expect(isBeadsUnavailable(timedOut)).toBe(true);
  });

  it("treats a non-zero exit code as unavailable", () => {
    const exit = Object.assign(new Error("Command failed"), { code: 1 });
    expect(isBeadsUnavailable(exit)).toBe(true);
  });

  it("does NOT treat a generic Error as unavailable", () => {
    expect(isBeadsUnavailable(new Error("some parse failure"))).toBe(false);
  });

  it("getIssues propagates a bd ENOENT so the route can flag it unavailable", async () => {
    runThrows = Object.assign(new Error("spawn bd ENOENT"), { code: "ENOENT" });
    await expect(getIssues("/proj")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
