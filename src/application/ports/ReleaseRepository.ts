/**
 * ReleaseRepository - Port interface for persisting update check state.
 */

import type { Release } from "@/domain/entities/Release";

export interface ReleaseRepository {
  /**
   * Get the timestamp of the last successful update check.
   */
  getLastChecked(): Promise<Date | null>;

  /**
   * Save the timestamp of the last successful update check.
   */
  saveLastChecked(at: Date): Promise<void>;

  /**
   * Get the cached latest release from the last check.
   */
  getCachedRelease(): Promise<Release | null>;

  /**
   * Save a release as the cached latest release.
   */
  saveCachedRelease(release: Release): Promise<void>;

  /**
   * Clear the cached release (e.g., after applying an update).
   */
  clearCachedRelease(): Promise<void>;
}
