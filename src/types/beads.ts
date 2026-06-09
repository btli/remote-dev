/**
 * Type definitions for the Beads issue tracker integration.
 *
 * Beads is a project-scoped issue tracker backed by Dolt (versioned SQL).
 * Issues are stored locally within each project directory.
 */

export interface BeadsIssue {
  id: string;
  title: string;
  description: string;
  status: BeadsStatus;
  priority: number; // 0-4
  issueType: BeadsIssueType;
  assignee: string | null;
  owner: string | null;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  closedAt: Date | null;
  closeReason: string | null;
  design: string;
  acceptanceCriteria: string;
  notes: string;
  metadata: Record<string, unknown>;
  labels: string[];
  dependencies: BeadsDependency[];
  dependents: BeadsDependency[];
  /** Structural parent links (this issue is a child, e.g. of an epic). NOT blocking. */
  parents: BeadsDependency[];
  /** Structural child links (this issue is a parent/epic). NOT blocking. */
  children: BeadsDependency[];
}

export type BeadsStatus = "open" | "in_progress" | "blocked" | "closed" | "deferred";
export type BeadsIssueType = "task" | "bug" | "feature" | "epic" | "chore" | "message";

export interface BeadsDependency {
  issueId: string;
  dependsOnId: string;
  type: string;
  createdAt: Date;
  createdBy: string;
  /**
   * Status of the blocker issue (dependsOnId) at fetch time, when known.
   * Optional/additive so consumers that don't need it compile unchanged.
   */
  dependsOnStatus?: BeadsStatus | null;
}

/**
 * Whether a blocking dependency still gates its issue. The `dependencies`
 * dolt table keeps rows after the blocker closes, so a dep only counts as
 * blocking while the blocker issue is still active (non-closed).
 */
export function isActiveBlocker(dep: BeadsDependency): boolean {
  // Unknown blocker status is treated as active (conservative).
  return dep.dependsOnStatus !== "closed";
}

/** Whether an issue has at least one still-active blocking dependency. */
export function hasActiveBlockers(issue: BeadsIssue): boolean {
  return issue.dependencies.some(isActiveBlocker);
}

export interface BeadsComment {
  id: string;
  issueId: string;
  author: string;
  text: string;
  createdAt: Date;
}

export interface BeadsEvent {
  id: string;
  issueId: string;
  eventType: string;
  actor: string;
  oldValue: string | null;
  newValue: string | null;
  comment: string | null;
  createdAt: Date;
}

export interface BeadsStats {
  total: number;
  open: number;
  inProgress: number;
  closed: number;
  blocked: number;
  ready: number;
  deferred: number;
}
