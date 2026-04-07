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
}

export type BeadsStatus = "open" | "in_progress" | "closed" | "deferred";
export type BeadsIssueType = "task" | "bug" | "feature" | "epic" | "chore" | "message";

export interface BeadsDependency {
  issueId: string;
  dependsOnId: string;
  type: string;
  createdAt: Date;
  createdBy: string;
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
