/**
 * TaskMapper - Maps between database records and Task domain entity.
 *
 * Handles conversion of:
 * - Database records (from Drizzle queries) → Task domain entities
 * - Task domain entities → Database record format (for inserts/updates)
 */

import { Task, type TaskProps, type TaskResult, type TaskError } from "@/domain/entities/Task";
import { TaskStatus } from "@/domain/value-objects/TaskStatus";
import { TaskType } from "@/domain/value-objects/TaskType";
import type { AgentProviderType } from "@/types/session";
import type { TaskStatusType, TaskTypeType } from "@/db/schema";

/**
 * Raw database record type from Drizzle query.
 * Matches the tasks schema.
 */
export interface TaskDbRecord {
  id: string;
  orchestratorId: string;
  userId: string;
  folderId: string | null;
  description: string;
  type: TaskTypeType;
  status: TaskStatusType;
  confidence: number;
  estimatedDuration: number | null;
  assignedAgent: string | null;
  delegationId: string | null;
  beadsIssueId: string | null;
  contextInjected: string | null;
  resultJson: string | null;
  errorJson: string | null;
  createdAt: Date | number;
  updatedAt: Date | number;
  completedAt: Date | number | null;
}

/**
 * Format for database insert/update operations.
 */
export interface TaskDbInsert {
  id: string;
  orchestratorId: string;
  userId: string;
  folderId: string | null;
  description: string;
  type: TaskTypeType;
  status: TaskStatusType;
  confidence: number;
  estimatedDuration: number | null;
  assignedAgent: AgentProviderType | null;
  delegationId: string | null;
  beadsIssueId: string | null;
  contextInjected: string | null;
  resultJson: string | null;
  errorJson: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export class TaskMapper {
  /**
   * Convert a database record to a Task domain entity.
   */
  static toDomain(record: TaskDbRecord): Task {
    const props: TaskProps = {
      id: record.id,
      orchestratorId: record.orchestratorId,
      userId: record.userId,
      folderId: record.folderId,
      description: record.description,
      type: TaskType.fromString(record.type),
      status: TaskStatus.fromString(record.status),
      confidence: record.confidence,
      estimatedDuration: record.estimatedDuration,
      assignedAgent: (record.assignedAgent as AgentProviderType) ?? null,
      delegationId: record.delegationId,
      beadsIssueId: record.beadsIssueId,
      contextInjected: record.contextInjected,
      result: record.resultJson ? parseJson<TaskResult>(record.resultJson) : null,
      error: record.errorJson ? parseJson<TaskError>(record.errorJson) : null,
      createdAt: toDate(record.createdAt),
      updatedAt: toDate(record.updatedAt),
      completedAt: record.completedAt ? toDate(record.completedAt) : null,
    };

    return Task.reconstitute(props);
  }

  /**
   * Convert multiple database records to Task domain entities.
   */
  static toDomainMany(records: TaskDbRecord[]): Task[] {
    return records.map((r) => TaskMapper.toDomain(r));
  }

  /**
   * Convert a Task domain entity to database insert format.
   */
  static toPersistence(task: Task): TaskDbInsert {
    return {
      id: task.id,
      orchestratorId: task.orchestratorId,
      userId: task.userId,
      folderId: task.folderId,
      description: task.description,
      type: task.type.toString() as TaskTypeType,
      status: task.status.toString() as TaskStatusType,
      confidence: task.confidence,
      estimatedDuration: task.estimatedDuration,
      assignedAgent: task.assignedAgent,
      delegationId: task.delegationId,
      beadsIssueId: task.beadsIssueId,
      contextInjected: task.contextInjected,
      resultJson: task.result ? JSON.stringify(task.result) : null,
      errorJson: task.error ? JSON.stringify(task.error) : null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt,
    };
  }

  /**
   * Convert a Task to API response format.
   */
  static toApiResponse(task: Task): {
    id: string;
    orchestratorId: string;
    userId: string;
    folderId: string | null;
    description: string;
    type: string;
    status: string;
    confidence: number;
    estimatedDuration: number | null;
    assignedAgent: AgentProviderType | null;
    delegationId: string | null;
    beadsIssueId: string | null;
    contextInjected: string | null;
    result: TaskResult | null;
    error: TaskError | null;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
  } {
    return {
      id: task.id,
      orchestratorId: task.orchestratorId,
      userId: task.userId,
      folderId: task.folderId,
      description: task.description,
      type: task.type.toString(),
      status: task.status.toString(),
      confidence: task.confidence,
      estimatedDuration: task.estimatedDuration,
      assignedAgent: task.assignedAgent,
      delegationId: task.delegationId,
      beadsIssueId: task.beadsIssueId,
      contextInjected: task.contextInjected,
      result: task.result,
      error: task.error,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt,
    };
  }
}

/**
 * Helper to convert string/number/Date to Date.
 * Drizzle with libsql may return dates as integers (timestamps).
 */
function toDate(value: Date | string | number): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "number") {
    return new Date(value);
  }
  return new Date(value);
}

/**
 * Helper to safely parse JSON.
 */
function parseJson<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
