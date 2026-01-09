/**
 * DelegationMapper - Maps between database records and Delegation domain entity.
 *
 * Handles conversion of:
 * - Database records (from Drizzle queries) → Delegation domain entities
 * - Delegation domain entities → Database record format (for inserts/updates)
 */

import {
  Delegation,
  type DelegationProps,
  type LogEntry,
  type DelegationResult,
  type DelegationError,
} from "@/domain/entities/Delegation";
import type { AgentProviderType } from "@/types/session";
import type { DelegationStatusType } from "@/db/schema";

/**
 * Raw database record type from Drizzle query.
 * Matches the delegations schema.
 */
export interface DelegationDbRecord {
  id: string;
  taskId: string;
  sessionId: string;
  worktreeId: string | null;
  agentProvider: string;
  status: DelegationStatusType;
  contextInjected: string | null;
  executionLogsJson: string;
  resultJson: string | null;
  errorJson: string | null;
  transcriptPath: string | null;
  createdAt: Date | number;
  updatedAt: Date | number;
  completedAt: Date | number | null;
}

/**
 * Format for database insert/update operations.
 */
export interface DelegationDbInsert {
  id: string;
  taskId: string;
  sessionId: string;
  worktreeId: string | null;
  agentProvider: AgentProviderType;
  status: DelegationStatusType;
  contextInjected: string | null;
  executionLogsJson: string;
  resultJson: string | null;
  errorJson: string | null;
  transcriptPath: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export class DelegationMapper {
  /**
   * Convert a database record to a Delegation domain entity.
   */
  static toDomain(record: DelegationDbRecord): Delegation {
    const executionLogs = parseJson<LogEntryRaw[]>(record.executionLogsJson) ?? [];

    const props: DelegationProps = {
      id: record.id,
      taskId: record.taskId,
      sessionId: record.sessionId,
      worktreeId: record.worktreeId,
      agentProvider: record.agentProvider as AgentProviderType,
      status: record.status as DelegationProps["status"],
      contextInjected: record.contextInjected,
      executionLogs: executionLogs.map(deserializeLogEntry),
      result: record.resultJson ? parseJson<DelegationResult>(record.resultJson) : null,
      error: record.errorJson ? parseJson<DelegationError>(record.errorJson) : null,
      transcriptPath: record.transcriptPath,
      createdAt: toDate(record.createdAt),
      updatedAt: toDate(record.updatedAt),
      completedAt: record.completedAt ? toDate(record.completedAt) : null,
    };

    return Delegation.reconstitute(props);
  }

  /**
   * Convert multiple database records to Delegation domain entities.
   */
  static toDomainMany(records: DelegationDbRecord[]): Delegation[] {
    return records.map((r) => DelegationMapper.toDomain(r));
  }

  /**
   * Convert a Delegation domain entity to database insert format.
   */
  static toPersistence(delegation: Delegation): DelegationDbInsert {
    const serializedLogs = delegation.executionLogs.map(serializeLogEntry);

    return {
      id: delegation.id,
      taskId: delegation.taskId,
      sessionId: delegation.sessionId,
      worktreeId: delegation.worktreeId,
      agentProvider: delegation.agentProvider,
      status: delegation.status as DelegationStatusType,
      contextInjected: delegation.contextInjected,
      executionLogsJson: JSON.stringify(serializedLogs),
      resultJson: delegation.result ? JSON.stringify(delegation.result) : null,
      errorJson: delegation.error ? JSON.stringify(delegation.error) : null,
      transcriptPath: delegation.transcriptPath,
      createdAt: delegation.createdAt,
      updatedAt: delegation.updatedAt,
      completedAt: delegation.completedAt,
    };
  }

  /**
   * Convert a Delegation to API response format.
   */
  static toApiResponse(delegation: Delegation): {
    id: string;
    taskId: string;
    sessionId: string;
    worktreeId: string | null;
    agentProvider: AgentProviderType;
    status: string;
    contextInjected: string | null;
    executionLogs: LogEntry[];
    result: DelegationResult | null;
    error: DelegationError | null;
    transcriptPath: string | null;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
  } {
    return {
      id: delegation.id,
      taskId: delegation.taskId,
      sessionId: delegation.sessionId,
      worktreeId: delegation.worktreeId,
      agentProvider: delegation.agentProvider,
      status: delegation.status,
      contextInjected: delegation.contextInjected,
      executionLogs: delegation.executionLogs,
      result: delegation.result,
      error: delegation.error,
      transcriptPath: delegation.transcriptPath,
      createdAt: delegation.createdAt,
      updatedAt: delegation.updatedAt,
      completedAt: delegation.completedAt,
    };
  }
}

/**
 * Raw log entry format from JSON (dates as strings).
 */
interface LogEntryRaw {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  metadata?: Record<string, unknown>;
}

/**
 * Deserialize a log entry from JSON format.
 */
function deserializeLogEntry(raw: LogEntryRaw): LogEntry {
  return {
    timestamp: new Date(raw.timestamp),
    level: raw.level,
    message: raw.message,
    metadata: raw.metadata,
  };
}

/**
 * Serialize a log entry for JSON storage.
 */
function serializeLogEntry(entry: LogEntry): LogEntryRaw {
  return {
    timestamp: entry.timestamp.toISOString(),
    level: entry.level,
    message: entry.message,
    metadata: entry.metadata,
  };
}

/**
 * Helper to convert string/number/Date to Date.
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
