/**
 * IInsightRepository - Port for insight persistence.
 *
 * This interface defines the contract for insight repository implementations.
 * The infrastructure layer will provide the concrete implementation.
 *
 * All mutation methods (save, update, delete) accept an optional transaction context
 * to support transactional operations across multiple repositories.
 */

import type { OrchestratorInsight } from "@/domain/entities/OrchestratorInsight";
import type { InsightType, InsightSeverity } from "@/types/orchestrator";
import type { TransactionContext } from "@/infrastructure/persistence/TransactionManager";

export interface IInsightRepository {
  /**
   * Find an insight by ID.
   * Returns null if not found.
   */
  findById(insightId: string): Promise<OrchestratorInsight | null>;

  /**
   * Find all insights for an orchestrator.
   */
  findByOrchestratorId(orchestratorId: string): Promise<OrchestratorInsight[]>;

  /**
   * Find insights for a specific session.
   */
  findBySessionId(sessionId: string): Promise<OrchestratorInsight[]>;

  /**
   * Find unresolved insights for an orchestrator.
   */
  findUnresolvedByOrchestratorId(orchestratorId: string): Promise<OrchestratorInsight[]>;

  /**
   * Find unresolved insights for a session.
   */
  findUnresolvedBySessionId(sessionId: string): Promise<OrchestratorInsight[]>;

  /**
   * Find insights by type.
   */
  findByType(orchestratorId: string, type: InsightType): Promise<OrchestratorInsight[]>;

  /**
   * Find insights by severity.
   */
  findBySeverity(
    orchestratorId: string,
    severity: InsightSeverity
  ): Promise<OrchestratorInsight[]>;

  /**
   * Find critical insights (severity = critical).
   */
  findCriticalByOrchestratorId(orchestratorId: string): Promise<OrchestratorInsight[]>;

  /**
   * Find recent insights (within last N seconds).
   */
  findRecentByOrchestratorId(
    orchestratorId: string,
    maxAgeSeconds: number
  ): Promise<OrchestratorInsight[]>;

  /**
   * Save a new insight.
   * Throws if an insight with the same ID already exists.
   *
   * @param insight - The insight to save
   * @param tx - Optional transaction context for atomic operations
   */
  save(insight: OrchestratorInsight, tx?: TransactionContext): Promise<void>;

  /**
   * Update an existing insight.
   * Throws if the insight does not exist.
   *
   * @param insight - The insight to update
   * @param tx - Optional transaction context for atomic operations
   */
  update(insight: OrchestratorInsight, tx?: TransactionContext): Promise<void>;

  /**
   * Delete an insight by ID.
   * Returns true if deleted, false if not found.
   *
   * @param insightId - The insight ID to delete
   * @param tx - Optional transaction context for atomic operations
   */
  delete(insightId: string, tx?: TransactionContext): Promise<boolean>;

  /**
   * Count unresolved insights for an orchestrator.
   */
  countUnresolvedByOrchestratorId(orchestratorId: string): Promise<number>;

  /**
   * Count insights by severity for an orchestrator.
   */
  countBySeverity(
    orchestratorId: string,
    severity: InsightSeverity
  ): Promise<number>;
}
