/**
 * IOrchestratorRepository - Port for orchestrator persistence.
 *
 * This interface defines the contract for orchestrator repository implementations.
 * The infrastructure layer will provide the concrete implementation.
 *
 * All mutation methods (save, update, delete) accept an optional transaction context
 * to support transactional operations across multiple repositories.
 */

import type { Orchestrator } from "@/domain/entities/Orchestrator";
import type { OrchestratorType, OrchestratorStatus } from "@/types/orchestrator";
import type { TransactionContext } from "@/infrastructure/persistence/TransactionManager";

export interface IOrchestratorRepository {
  /**
   * Find an orchestrator by ID.
   * Returns null if not found.
   *
   * @param orchestratorId - The orchestrator ID
   * @param tx - Optional transaction context for consistent reads
   */
  findById(orchestratorId: string, tx?: TransactionContext): Promise<Orchestrator | null>;

  /**
   * Find all orchestrators for a user.
   *
   * @param userId - The user ID
   * @param tx - Optional transaction context for consistent reads
   */
  findByUserId(userId: string, tx?: TransactionContext): Promise<Orchestrator[]>;

  /**
   * Find orchestrators by type for a user.
   *
   * @param userId - The user ID
   * @param type - The orchestrator type
   * @param tx - Optional transaction context for consistent reads
   */
  findByUserIdAndType(userId: string, type: OrchestratorType, tx?: TransactionContext): Promise<Orchestrator[]>;

  /**
   * Find the master orchestrator for a user.
   * Returns null if not found.
   *
   * @param userId - The user ID
   * @param tx - Optional transaction context for consistent reads
   */
  findMasterByUserId(userId: string, tx?: TransactionContext): Promise<Orchestrator | null>;

  /**
   * Find sub-orchestrators for a specific folder.
   *
   * @param userId - The user ID
   * @param scopeId - The folder ID
   * @param tx - Optional transaction context for consistent reads
   */
  findByScope(userId: string, scopeId: string, tx?: TransactionContext): Promise<Orchestrator[]>;

  /**
   * Find active (non-paused) orchestrators for a user.
   *
   * @param userId - The user ID
   * @param tx - Optional transaction context for consistent reads
   */
  findActiveByUserId(userId: string, tx?: TransactionContext): Promise<Orchestrator[]>;

  /**
   * Find orchestrators by status.
   *
   * @param userId - The user ID
   * @param status - The orchestrator status
   * @param tx - Optional transaction context for consistent reads
   */
  findByStatus(userId: string, status: OrchestratorStatus, tx?: TransactionContext): Promise<Orchestrator[]>;

  /**
   * Check if a user already has a master orchestrator.
   *
   * @param userId - The user ID
   * @param tx - Optional transaction context for consistent reads
   */
  hasMaster(userId: string, tx?: TransactionContext): Promise<boolean>;

  /**
   * Save a new orchestrator.
   * Throws if an orchestrator with the same ID already exists.
   *
   * @param orchestrator - The orchestrator to save
   * @param tx - Optional transaction context for atomic operations
   */
  save(orchestrator: Orchestrator, tx?: TransactionContext): Promise<void>;

  /**
   * Update an existing orchestrator.
   * Throws if the orchestrator does not exist.
   *
   * @param orchestrator - The orchestrator to update
   * @param tx - Optional transaction context for atomic operations
   */
  update(orchestrator: Orchestrator, tx?: TransactionContext): Promise<void>;

  /**
   * Delete an orchestrator by ID.
   * Returns true if deleted, false if not found.
   *
   * @param orchestratorId - The orchestrator ID to delete
   * @param tx - Optional transaction context for atomic operations
   */
  delete(orchestratorId: string, tx?: TransactionContext): Promise<boolean>;

  /**
   * Count orchestrators for a user.
   */
  countByUserId(userId: string): Promise<number>;
}
