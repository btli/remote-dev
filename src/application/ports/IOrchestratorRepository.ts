/**
 * IOrchestratorRepository - Port for orchestrator persistence.
 *
 * This interface defines the contract for orchestrator repository implementations.
 * The infrastructure layer will provide the concrete implementation.
 */

import type { Orchestrator } from "@/domain/entities/Orchestrator";
import type { OrchestratorType, OrchestratorStatus } from "@/types/orchestrator";

export interface IOrchestratorRepository {
  /**
   * Find an orchestrator by ID.
   * Returns null if not found.
   */
  findById(orchestratorId: string): Promise<Orchestrator | null>;

  /**
   * Find all orchestrators for a user.
   */
  findByUserId(userId: string): Promise<Orchestrator[]>;

  /**
   * Find orchestrators by type for a user.
   */
  findByUserIdAndType(userId: string, type: OrchestratorType): Promise<Orchestrator[]>;

  /**
   * Find the master orchestrator for a user.
   * Returns null if not found.
   */
  findMasterByUserId(userId: string): Promise<Orchestrator | null>;

  /**
   * Find sub-orchestrators for a specific folder.
   */
  findByScope(userId: string, scopeId: string): Promise<Orchestrator[]>;

  /**
   * Find active (non-paused) orchestrators for a user.
   */
  findActiveByUserId(userId: string): Promise<Orchestrator[]>;

  /**
   * Find orchestrators by status.
   */
  findByStatus(userId: string, status: OrchestratorStatus): Promise<Orchestrator[]>;

  /**
   * Check if a user already has a master orchestrator.
   */
  hasMaster(userId: string): Promise<boolean>;

  /**
   * Save a new orchestrator.
   * Throws if an orchestrator with the same ID already exists.
   */
  save(orchestrator: Orchestrator): Promise<void>;

  /**
   * Update an existing orchestrator.
   * Throws if the orchestrator does not exist.
   */
  update(orchestrator: Orchestrator): Promise<void>;

  /**
   * Delete an orchestrator by ID.
   * Returns true if deleted, false if not found.
   */
  delete(orchestratorId: string): Promise<boolean>;

  /**
   * Count orchestrators for a user.
   */
  countByUserId(userId: string): Promise<number>;
}
