/**
 * IAuditLogRepository - Port for audit log persistence.
 *
 * This interface defines the contract for audit log repository implementations.
 * The infrastructure layer will provide the concrete implementation.
 *
 * Note: Audit logs are immutable - only save and query operations are supported.
 */

import type { OrchestratorAuditLog } from "@/domain/entities/OrchestratorAuditLog";
import type { AuditLogActionType } from "@/types/orchestrator";

export interface IAuditLogRepository {
  /**
   * Find an audit log entry by ID.
   * Returns null if not found.
   */
  findById(auditLogId: string): Promise<OrchestratorAuditLog | null>;

  /**
   * Find all audit log entries for an orchestrator.
   * Results are ordered by timestamp descending (newest first).
   */
  findByOrchestratorId(orchestratorId: string): Promise<OrchestratorAuditLog[]>;

  /**
   * Find audit log entries for a specific session.
   * Returns all entries where targetSessionId matches.
   */
  findBySessionId(sessionId: string): Promise<OrchestratorAuditLog[]>;

  /**
   * Find audit log entries by action type.
   */
  findByActionType(
    orchestratorId: string,
    actionType: AuditLogActionType
  ): Promise<OrchestratorAuditLog[]>;

  /**
   * Find recent audit log entries (within last N seconds).
   */
  findRecentByOrchestratorId(
    orchestratorId: string,
    maxAgeSeconds: number
  ): Promise<OrchestratorAuditLog[]>;

  /**
   * Find audit log entries within a time range.
   */
  findByTimeRange(
    orchestratorId: string,
    startDate: Date,
    endDate: Date
  ): Promise<OrchestratorAuditLog[]>;

  /**
   * Get the most recent audit log entry for an orchestrator.
   * Returns null if no entries exist.
   */
  findLatestByOrchestratorId(
    orchestratorId: string
  ): Promise<OrchestratorAuditLog | null>;

  /**
   * Save a new audit log entry.
   * Throws if an entry with the same ID already exists.
   *
   * Note: Audit logs are immutable - no update operation is provided.
   */
  save(auditLog: OrchestratorAuditLog): Promise<void>;

  /**
   * Count audit log entries for an orchestrator.
   */
  countByOrchestratorId(orchestratorId: string): Promise<number>;

  /**
   * Count audit log entries by action type.
   */
  countByActionType(
    orchestratorId: string,
    actionType: AuditLogActionType
  ): Promise<number>;

  /**
   * Delete old audit log entries (for cleanup/retention policies).
   * Returns the number of entries deleted.
   */
  deleteOlderThan(date: Date): Promise<number>;
}
