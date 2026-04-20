/**
 * Project Task Types
 *
 * Type definitions for the project task tracker feature.
 * Tasks are folder-scoped and support manual + agent sources.
 */

export type TaskPriority = "critical" | "high" | "medium" | "low";
export type TaskStatus = "open" | "in_progress" | "done" | "cancelled";
export type TaskSource = "manual" | "agent";

export interface TaskLabel {
  name: string;
  color: string; // hex color without #
}

export interface TaskSubtask {
  id: string;
  title: string;
  completed: boolean;
}

export interface TaskDependency {
  blockerId: string;
  blockedId: string;
}

export interface ProjectTask {
  id: string;
  userId: string;
  folderId: string | null;
  /** Phase 3 dual-write: project id bridge, populated alongside folderId. */
  projectId: string | null;
  sessionId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  source: TaskSource;
  labels: TaskLabel[];
  subtasks: TaskSubtask[];
  metadata: Record<string, unknown>;
  instructions: string | null;
  agentTaskKey: string | null;
  owner: string | null;
  dueDate: Date | null;
  githubIssueUrl: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  blockedBy: string[]; // populated from task_dependency join
}

export interface CreateTaskInput {
  folderId?: string | null;
  /** Project id override. When provided, translation from folderId is skipped. */
  projectId?: string | null;
  sessionId?: string | null;
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  source?: TaskSource;
  labels?: TaskLabel[];
  subtasks?: TaskSubtask[];
  metadata?: Record<string, unknown>;
  instructions?: string | null;
  agentTaskKey?: string | null;
  owner?: string | null;
  dueDate?: string | null; // ISO string
  githubIssueUrl?: string | null;
  sortOrder?: number;
  blockedBy?: string[]; // task IDs that block this task
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  labels?: TaskLabel[];
  subtasks?: TaskSubtask[];
  metadata?: Record<string, unknown>;
  instructions?: string | null;
  agentTaskKey?: string | null;
  owner?: string | null;
  dueDate?: string | null; // ISO string
  githubIssueUrl?: string | null;
  sortOrder?: number;
  blockedBy?: string[]; // replace all blockers for this task
}

/** Default labels for new projects */
export const DEFAULT_TASK_LABELS: TaskLabel[] = [
  { name: "Bug", color: "e11d48" },
  { name: "Feature", color: "8b5cf6" },
  { name: "Task", color: "3b82f6" },
  { name: "Improvement", color: "f59e0b" },
  { name: "Documentation", color: "6b7280" },
];

/** Priority display config */
export const PRIORITY_CONFIG: Record<
  TaskPriority,
  { label: string; color: string; sortWeight: number }
> = {
  critical: { label: "Critical", color: "ef4444", sortWeight: 0 },
  high: { label: "High", color: "f97316", sortWeight: 1 },
  medium: { label: "Medium", color: "eab308", sortWeight: 2 },
  low: { label: "Low", color: "6b7280", sortWeight: 3 },
};
