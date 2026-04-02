import type { RowDataPacket } from "mysql2/promise";
import { beadsQuery } from "@/lib/beads-db";
import { safeJsonParse } from "@/lib/utils";
import type {
  BeadsIssue,
  BeadsComment,
  BeadsEvent,
  BeadsDependency,
  BeadsStats,
  BeadsStatus,
  BeadsIssueType,
} from "@/types/beads";

// ----- Row types for DB results -----

interface IssueRow extends RowDataPacket {
  id: string;
  title: string;
  description: string | null;
  design: string | null;
  acceptance_criteria: string | null;
  notes: string | null;
  status: string;
  priority: number;
  issue_type: string;
  assignee: string | null;
  owner: string | null;
  created_at: Date;
  created_by: string | null;
  updated_at: Date;
  closed_at: Date | null;
  close_reason: string | null;
  metadata: string | null;
}

interface LabelRow extends RowDataPacket {
  issue_id: string;
  label: string;
}

interface DependencyRow extends RowDataPacket {
  issue_id: string;
  depends_on_id: string;
  type: string;
  created_at: Date;
  created_by: string | null;
}

interface CommentRow extends RowDataPacket {
  id: string;
  issue_id: string;
  author: string | null;
  text: string | null;
  created_at: Date;
}

interface EventRow extends RowDataPacket {
  id: string;
  issue_id: string;
  event_type: string;
  actor: string | null;
  old_value: string | null;
  new_value: string | null;
  comment: string | null;
  created_at: Date;
}

interface CountRow extends RowDataPacket {
  cnt: number;
}

interface StatusCountRow extends RowDataPacket {
  status: string;
  cnt: number;
}

// ----- Mappers -----

function mapIssue(
  row: IssueRow,
  labels: string[],
  dependencies: BeadsDependency[],
  dependents: BeadsDependency[]
): BeadsIssue {
  const metadata = safeJsonParse<Record<string, unknown>>(row.metadata, {});

  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    design: row.design ?? "",
    acceptanceCriteria: row.acceptance_criteria ?? "",
    notes: row.notes ?? "",
    status: row.status as BeadsStatus,
    priority: row.priority,
    issueType: row.issue_type as BeadsIssueType,
    assignee: row.assignee,
    owner: row.owner,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    closeReason: row.close_reason,
    metadata,
    labels,
    dependencies,
    dependents,
  };
}

function mapDependency(row: DependencyRow): BeadsDependency {
  return {
    issueId: row.issue_id,
    dependsOnId: row.depends_on_id,
    type: row.type,
    createdAt: row.created_at,
    createdBy: row.created_by ?? "",
  };
}

function mapComment(row: CommentRow): BeadsComment {
  return {
    id: row.id,
    issueId: row.issue_id,
    author: row.author ?? "",
    text: row.text ?? "",
    createdAt: row.created_at,
  };
}

function mapEvent(row: EventRow): BeadsEvent {
  return {
    id: row.id,
    issueId: row.issue_id,
    eventType: row.event_type,
    actor: row.actor ?? "",
    oldValue: row.old_value,
    newValue: row.new_value,
    comment: row.comment,
    createdAt: row.created_at,
  };
}

// ----- Public API -----

export interface GetIssuesOptions {
  status?: BeadsStatus;
  issueType?: BeadsIssueType;
}

export async function getIssues(
  projectPath: string,
  opts?: GetIssuesOptions
): Promise<BeadsIssue[]> {
  let sql = `SELECT * FROM issues WHERE 1=1`;
  const params: (string | number | null)[] = [];

  if (opts?.status) {
    sql += ` AND status = ?`;
    params.push(opts.status);
  }
  if (opts?.issueType) {
    sql += ` AND issue_type = ?`;
    params.push(opts.issueType);
  }

  sql += ` ORDER BY created_at DESC`;

  const issues = await beadsQuery<IssueRow>(projectPath, sql, params);

  if (issues.length === 0) return [];

  const issueIds = issues.map((i) => i.id);
  const placeholders = issueIds.map(() => "?").join(",");

  // Batch-load labels and dependencies
  const [labels, deps] = await Promise.all([
    beadsQuery<LabelRow>(
      projectPath,
      `SELECT issue_id, label FROM labels WHERE issue_id IN (${placeholders})`,
      issueIds
    ),
    beadsQuery<DependencyRow>(
      projectPath,
      `SELECT * FROM dependencies WHERE issue_id IN (${placeholders}) OR depends_on_id IN (${placeholders})`,
      [...issueIds, ...issueIds]
    ),
  ]);

  // Group labels by issue
  const labelMap = new Map<string, string[]>();
  for (const l of labels) {
    const arr = labelMap.get(l.issue_id) ?? [];
    arr.push(l.label);
    labelMap.set(l.issue_id, arr);
  }

  // Group dependencies
  const depsMap = new Map<string, BeadsDependency[]>();
  const dependentsMap = new Map<string, BeadsDependency[]>();
  for (const d of deps) {
    const mapped = mapDependency(d);
    const arr = depsMap.get(d.issue_id) ?? [];
    arr.push(mapped);
    depsMap.set(d.issue_id, arr);

    const arr2 = dependentsMap.get(d.depends_on_id) ?? [];
    arr2.push(mapped);
    dependentsMap.set(d.depends_on_id, arr2);
  }

  return issues.map((row) =>
    mapIssue(
      row,
      labelMap.get(row.id) ?? [],
      depsMap.get(row.id) ?? [],
      dependentsMap.get(row.id) ?? []
    )
  );
}

export async function getIssue(
  projectPath: string,
  issueId: string
): Promise<BeadsIssue | null> {
  const issues = await beadsQuery<IssueRow>(
    projectPath,
    `SELECT * FROM issues WHERE id = ?`,
    [issueId]
  );
  if (issues.length === 0) return null;

  const row = issues[0];

  const [labels, deps] = await Promise.all([
    beadsQuery<LabelRow>(
      projectPath,
      `SELECT issue_id, label FROM labels WHERE issue_id = ?`,
      [issueId]
    ),
    beadsQuery<DependencyRow>(
      projectPath,
      `SELECT * FROM dependencies WHERE issue_id = ? OR depends_on_id = ?`,
      [issueId, issueId]
    ),
  ]);

  const dependencies = deps
    .filter((d) => d.issue_id === issueId)
    .map(mapDependency);
  const dependents = deps
    .filter((d) => d.depends_on_id === issueId)
    .map(mapDependency);

  return mapIssue(
    row,
    labels.map((l) => l.label),
    dependencies,
    dependents
  );
}

export async function getIssueComments(
  projectPath: string,
  issueId: string
): Promise<BeadsComment[]> {
  const rows = await beadsQuery<CommentRow>(
    projectPath,
    `SELECT * FROM comments WHERE issue_id = ? ORDER BY created_at ASC`,
    [issueId]
  );
  return rows.map(mapComment);
}

export async function getIssueEvents(
  projectPath: string,
  issueId: string
): Promise<BeadsEvent[]> {
  const rows = await beadsQuery<EventRow>(
    projectPath,
    `SELECT * FROM events WHERE issue_id = ? ORDER BY created_at ASC`,
    [issueId]
  );
  return rows.map(mapEvent);
}

export async function getStats(projectPath: string): Promise<BeadsStats> {
  const [statusCounts, blockedCount] = await Promise.all([
    beadsQuery<StatusCountRow>(
      projectPath,
      `SELECT status, COUNT(*) as cnt FROM issues GROUP BY status`
    ),
    beadsQuery<CountRow>(
      projectPath,
      `SELECT COUNT(DISTINCT d.issue_id) as cnt
       FROM dependencies d
       JOIN issues blocked ON blocked.id = d.issue_id
       JOIN issues blocker ON blocker.id = d.depends_on_id
       WHERE blocked.status != 'closed' AND blocker.status != 'closed'`
    ),
  ]);

  const counts: Record<string, number> = {};
  let total = 0;
  for (const row of statusCounts) {
    counts[row.status] = row.cnt;
    total += row.cnt;
  }

  const blocked = blockedCount[0]?.cnt ?? 0;
  const open = counts["open"] ?? 0;
  const inProgress = counts["in_progress"] ?? 0;

  // "ready" = open issues that are NOT blocked
  const ready = Math.max(0, open - blocked);

  return {
    total,
    open,
    inProgress,
    closed: counts["closed"] ?? 0,
    blocked,
    ready,
  };
}
