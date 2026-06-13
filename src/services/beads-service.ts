import {
  runBdExportCached,
  runBdJson,
  parseJsonl,
  isValidIssueId,
  isBeadsUnavailable,
} from "@/lib/beads-cli";
import { createLogger } from "@/lib/logger";
import type {
  BeadsIssue,
  BeadsComment,
  BeadsEvent,
  BeadsDependency,
  BeadsStats,
  BeadsStatus,
  BeadsIssueType,
} from "@/types/beads";

const log = createLogger("BeadsService");

// ----- Dependency classification -----

/** Dependency types that represent a true blocking relationship (gate ready/blocked). */
export const BLOCKING_DEP_TYPES: ReadonlySet<string> = new Set(["blocks"]);
/** Dependency types that represent structural epic/parent hierarchy (NOT blocking). */
export const STRUCTURAL_DEP_TYPES: ReadonlySet<string> = new Set([
  "parent-child",
  "child-of",
]);

export type DependencyClass = "blocking" | "structural" | "other";

export function classifyDependency(type: string): DependencyClass {
  if (BLOCKING_DEP_TYPES.has(type)) return "blocking";
  if (STRUCTURAL_DEP_TYPES.has(type)) return "structural";
  return "other";
}

export interface GroupedDependencies {
  /** Blocking deps keyed by the blocked issue id (BeadsDependency.issueId). */
  dependencies: Map<string, BeadsDependency[]>;
  /** Blocking deps keyed by the blocker issue id (BeadsDependency.dependsOnId). */
  dependents: Map<string, BeadsDependency[]>;
  /** Structural parent links keyed by the child issue id (BeadsDependency.issueId). */
  parents: Map<string, BeadsDependency[]>;
  /** Structural child links keyed by the parent issue id (BeadsDependency.dependsOnId). */
  children: Map<string, BeadsDependency[]>;
}

/**
 * Bucket already-mapped dependency links by their semantic class so that the
 * ready/blocked computation only ever sees true `blocks` links, while epic
 * hierarchy (`parent-child`/`child-of`) is surfaced separately and provenance
 * links (`relates-to`/`discovered-from`) are dropped. Pure + unit-tested.
 */
export function groupDependencies(deps: BeadsDependency[]): GroupedDependencies {
  const grouped: GroupedDependencies = {
    dependencies: new Map(),
    dependents: new Map(),
    parents: new Map(),
    children: new Map(),
  };
  const push = (map: Map<string, BeadsDependency[]>, key: string, value: BeadsDependency) => {
    const arr = map.get(key) ?? [];
    arr.push(value);
    map.set(key, arr);
  };
  for (const d of deps) {
    switch (classifyDependency(d.type)) {
      case "blocking":
        push(grouped.dependencies, d.issueId, d);
        push(grouped.dependents, d.dependsOnId, d);
        break;
      case "structural":
        push(grouped.parents, d.issueId, d);
        push(grouped.children, d.dependsOnId, d);
        break;
      case "other":
        break;
    }
  }
  return grouped;
}

// ----- Raw bd JSON shapes (parsed from `bd export` / `bd history`) -----

/** A `dependencies[]` element from `bd export`. Note bd uses `depends_on_id`. */
interface RawBdDependency {
  issue_id?: string;
  depends_on_id?: string;
  type?: string;
  created_at?: string;
  created_by?: string;
  metadata?: string;
}

/** A `comments[]` element from `bd export`. */
interface RawBdComment {
  id?: string;
  issue_id?: string;
  author?: string;
  text?: string;
  created_at?: string;
}

/** A single issue record from `bd export` (one JSON object per JSONL line). */
interface RawBdIssue {
  id?: string;
  title?: string;
  description?: string;
  design?: string;
  acceptance_criteria?: string;
  notes?: string;
  status?: string;
  priority?: number;
  issue_type?: string;
  assignee?: string;
  owner?: string;
  created_at?: string;
  created_by?: string;
  updated_at?: string;
  closed_at?: string;
  close_reason?: string;
  labels?: string[];
  dependencies?: RawBdDependency[];
  comments?: RawBdComment[];
}

/** `bd status --json` payload. */
interface RawBdStatus {
  schema_version?: number;
  summary?: {
    total_issues?: number;
    open_issues?: number;
    in_progress_issues?: number;
    closed_issues?: number;
    blocked_issues?: number;
    deferred_issues?: number;
    ready_issues?: number;
  };
}

/** One entry from `bd history <id> --json` (ordered newest-first). */
interface RawBdHistoryEntry {
  CommitHash?: string;
  Committer?: string;
  CommitDate?: string;
  Issue?: RawBdIssue;
}

// ----- Raw -> domain helpers -----

/** Parse an RFC3339 date string into a Date; missing/empty -> epoch (defensive). */
function toDate(value: string | undefined): Date {
  return value ? new Date(value) : new Date(0);
}

/** Validate that a parsed JSONL record looks like an issue with an id. */
function isRawIssue(value: unknown): value is RawBdIssue {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

/** Load and parse the full `bd export` (every non-infra issue) for a project. */
async function loadExport(projectPath: string): Promise<RawBdIssue[]> {
  const stdout = await runBdExportCached(projectPath);
  const records = parseJsonl(stdout);
  const issues: RawBdIssue[] = [];
  for (const record of records) {
    if (isRawIssue(record)) {
      issues.push(record);
    } else {
      log.debug("Skipping non-issue export record", { record: JSON.stringify(record).slice(0, 200) });
    }
  }
  return issues;
}

/** Map every export record's id to its status (defaulting to "open"). */
function buildStatusMap(records: RawBdIssue[]): Map<string, BeadsStatus> {
  const statusById = new Map<string, BeadsStatus>();
  for (const r of records) {
    if (r.id) statusById.set(r.id, (r.status ?? "open") as BeadsStatus);
  }
  return statusById;
}

/**
 * Flatten the `dependencies[]` arrays of every export record into the flat
 * `BeadsDependency` edge list the mapper/grouper expect, normalizing bd's
 * `depends_on_id` to `dependsOnId` and resolving each blocker's status from the
 * full export's id->status map. Edges with no target are dropped (wisp/external).
 */
function buildEdges(
  records: RawBdIssue[],
  statusById: Map<string, BeadsStatus>
): BeadsDependency[] {
  const edges: BeadsDependency[] = [];
  for (const record of records) {
    for (const dep of record.dependencies ?? []) {
      const dependsOnId = dep.depends_on_id;
      if (!dependsOnId) continue; // skip wisp / external (no resolvable target)
      edges.push({
        issueId: dep.issue_id ?? record.id ?? "",
        dependsOnId,
        type: dep.type ?? "",
        createdAt: toDate(dep.created_at),
        createdBy: dep.created_by ?? "",
        dependsOnStatus: statusById.get(dependsOnId) ?? null,
      });
    }
  }
  return edges;
}

/**
 * Build the grouped dependency view over the FULL export: status map -> flat
 * edges -> semantic buckets. Computed from every record (not just the visible
 * set) so incoming dependents/children and blocker statuses always resolve.
 */
function groupExportDependencies(records: RawBdIssue[]): GroupedDependencies {
  const edges = buildEdges(records, buildStatusMap(records));
  return groupDependencies(edges);
}

function mapIssue(
  record: RawBdIssue,
  grouped: GroupedDependencies
): BeadsIssue {
  const id = record.id ?? "";
  return {
    id,
    title: record.title ?? "",
    description: record.description ?? "",
    design: record.design ?? "",
    acceptanceCriteria: record.acceptance_criteria ?? "",
    notes: record.notes ?? "",
    status: (record.status ?? "open") as BeadsStatus,
    priority: record.priority ?? 0,
    issueType: (record.issue_type ?? "task") as BeadsIssueType,
    assignee: record.assignee ?? null,
    owner: record.owner ?? null,
    createdAt: toDate(record.created_at),
    createdBy: record.created_by ?? null,
    updatedAt: toDate(record.updated_at),
    closedAt: record.closed_at ? new Date(record.closed_at) : null,
    closeReason: record.close_reason ?? null,
    // bd export has no per-issue metadata field — map to {}.
    metadata: {},
    labels: record.labels ?? [],
    dependencies: grouped.dependencies.get(id) ?? [],
    dependents: grouped.dependents.get(id) ?? [],
    parents: grouped.parents.get(id) ?? [],
    children: grouped.children.get(id) ?? [],
  };
}

function mapComment(raw: RawBdComment): BeadsComment {
  return {
    id: raw.id ?? "",
    issueId: raw.issue_id ?? "",
    author: raw.author ?? "",
    text: raw.text ?? "",
    createdAt: toDate(raw.created_at),
  };
}

// ----- Public API -----

export interface GetIssuesOptions {
  status?: BeadsStatus;
  issueType?: BeadsIssueType;
  closedRetentionDays?: number;
}

/**
 * Does a record pass the visibility filter? Mirrors the former SQL predicate:
 * either an explicit status filter, or the default of non-closed OR
 * recently-closed (within retention) OR an epic (always shown). An optional
 * issueType filter applies on top.
 */
function passesFilter(
  record: RawBdIssue,
  opts: GetIssuesOptions | undefined,
  cutoffMs: number
): boolean {
  const status = record.status ?? "open";
  if (opts?.status) {
    if (status !== opts.status) return false;
  } else {
    const closedAtMs = record.closed_at ? new Date(record.closed_at).getTime() : null;
    const visible =
      status !== "closed" ||
      (closedAtMs !== null && closedAtMs >= cutoffMs) ||
      record.issue_type === "epic";
    if (!visible) return false;
  }
  if (opts?.issueType && record.issue_type !== opts.issueType) return false;
  return true;
}

export async function getIssues(
  projectPath: string,
  opts?: GetIssuesOptions
): Promise<BeadsIssue[]> {
  const retentionDays = opts?.closedRetentionDays ?? 7;
  const cutoffMs = Date.now() - retentionDays * 86400_000;

  const records = await loadExport(projectPath);

  // Primary visible set.
  const included = new Map<string, RawBdIssue>();
  for (const r of records) {
    if (r.id && passesFilter(r, opts, cutoffMs)) included.set(r.id, r);
  }

  // Also include children of any included epic (same filter), mirroring the
  // former epic-children fetch. Children are linked via structural edges whose
  // target (depends_on_id) is the epic.
  const epicIds = new Set(
    [...included.values()].filter((r) => r.issue_type === "epic").map((r) => r.id!)
  );
  if (epicIds.size > 0) {
    for (const r of records) {
      if (!r.id || included.has(r.id)) continue;
      const isEpicChild = (r.dependencies ?? []).some(
        (d) =>
          STRUCTURAL_DEP_TYPES.has(d.type ?? "") &&
          d.depends_on_id !== undefined &&
          epicIds.has(d.depends_on_id)
      );
      if (isEpicChild && passesFilter(r, opts, cutoffMs)) {
        included.set(r.id, r);
      }
    }
  }

  if (included.size === 0) return [];

  // Group edges from the FULL export so incoming (dependents/children) links
  // resolve even when the other endpoint isn't in the visible set.
  const grouped = groupExportDependencies(records);

  // Sort by created_at DESC to match the former `ORDER BY created_at DESC`.
  const result = [...included.values()].sort(
    (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
  );
  return result.map((record) => mapIssue(record, grouped));
}

export async function getIssue(
  projectPath: string,
  issueId: string
): Promise<BeadsIssue | null> {
  const records = await loadExport(projectPath);
  const record = records.find((r) => r.id === issueId);
  if (!record) return null;

  return mapIssue(record, groupExportDependencies(records));
}

export async function getIssueComments(
  projectPath: string,
  issueId: string
): Promise<BeadsComment[]> {
  const records = await loadExport(projectPath);
  const record = records.find((r) => r.id === issueId);
  if (!record) return [];
  return (record.comments ?? [])
    .map(mapComment)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** Fields whose change between two snapshots becomes a timeline event. */
const EVENT_FIELDS = [
  { field: "status" as const, eventType: "status_change" },
  { field: "assignee" as const, eventType: "assignee_change" },
  { field: "priority" as const, eventType: "priority_change" },
] as const;

export async function getIssueEvents(
  projectPath: string,
  issueId: string
): Promise<BeadsEvent[]> {
  if (!isValidIssueId(issueId)) return [];
  let history: RawBdHistoryEntry[];
  try {
    history = await runBdJson<RawBdHistoryEntry[]>(projectPath, [
      "history",
      issueId,
      "--json",
    ]);
  } catch (err) {
    if (isBeadsUnavailable(err)) throw err; // let the route degrade to { unavailable: true }
    log.warn("bd history failed; returning no events", { issueId, error: String(err) });
    return [];
  }
  if (!Array.isArray(history) || history.length < 2) return [];

  // bd returns history newest-first; diff oldest -> newest so we report the
  // transition into each new value.
  const ordered = [...history].reverse();
  const events: BeadsEvent[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]?.Issue;
    const curr = ordered[i]?.Issue;
    const entry = ordered[i];
    if (!prev || !curr) continue;

    let perCommit = 0;
    for (const { field, eventType } of EVENT_FIELDS) {
      const oldRaw = prev[field];
      const newRaw = curr[field];
      const oldValue = oldRaw === undefined || oldRaw === null ? null : String(oldRaw);
      const newValue = newRaw === undefined || newRaw === null ? null : String(newRaw);
      if (oldValue === newValue) continue;

      const commitHash = entry.CommitHash ?? `${issueId}-${i}`;
      events.push({
        id: perCommit === 0 ? commitHash : `${commitHash}-${perCommit}`,
        issueId,
        eventType,
        actor: entry.Committer ?? "",
        oldValue,
        newValue,
        comment: null,
        createdAt: toDate(entry.CommitDate),
      });
      perCommit++;
    }
  }
  return events;
}

export async function getStats(projectPath: string): Promise<BeadsStats> {
  const status = await runBdJson<RawBdStatus>(projectPath, ["status", "--json"]);
  const s = status.summary ?? {};
  return {
    total: s.total_issues ?? 0,
    open: s.open_issues ?? 0,
    inProgress: s.in_progress_issues ?? 0,
    closed: s.closed_issues ?? 0,
    blocked: s.blocked_issues ?? 0,
    ready: s.ready_issues ?? 0,
    deferred: s.deferred_issues ?? 0,
  };
}
