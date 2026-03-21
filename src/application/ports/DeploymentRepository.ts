/**
 * DeploymentRepository - Port interface for persisting auto-update deployment state.
 *
 * Stores the current deployment lifecycle state as a singleton row.
 * Used by the auto-update orchestrator to track and recover deployment progress.
 */

import type { UpdateDeployment } from "@/domain/entities/UpdateDeployment";

export interface DeploymentRepository {
  /**
   * Get the current deployment state, or null if no deployment is tracked.
   */
  getCurrent(): Promise<UpdateDeployment | null>;

  /**
   * Save the current deployment state.
   * Upserts — creates if not present, updates if exists.
   */
  save(deployment: UpdateDeployment): Promise<void>;

  /**
   * Clear the current deployment state.
   * Called after a deployment completes (success or terminal failure).
   */
  clear(): Promise<void>;
}
