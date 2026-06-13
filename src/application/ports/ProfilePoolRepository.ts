/**
 * ProfilePoolRepository - Port for Claude profile fallback pools.
 *
 * A pool is a named, ordered set of Claude profiles a project rotates through
 * when its primary profile is limited. Members carry a rotation `priority`
 * (lower = higher priority / earlier in rotation).
 */

export interface PoolEntry {
  profileId: string;
  /** Lower = higher priority / earlier in rotation. */
  priority: number;
}

export interface PoolSummary {
  id: string;
  name: string;
}

export interface ProfilePoolRepository {
  /** Members of a pool, ordered by ascending priority. */
  membersOfPool(poolId: string): Promise<PoolEntry[]>;

  /** All pools owned by a user. */
  poolsForUser(userId: string): Promise<PoolSummary[]>;

  /** Create a pool; returns the new pool id. */
  createPool(userId: string, name: string): Promise<string>;

  renamePool(poolId: string, name: string): Promise<void>;

  deletePool(poolId: string): Promise<void>;

  /** Add (or upsert) a profile into a pool at the given priority. */
  addMember(poolId: string, profileId: string, priority: number): Promise<void>;

  removeMember(poolId: string, profileId: string): Promise<void>;

  setPriority(
    poolId: string,
    profileId: string,
    priority: number
  ): Promise<void>;
}
