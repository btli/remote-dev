/**
 * ProfilePoolRepository - Port for Claude fallback pools.
 *
 * A pool is a named, ordered set of Claude ACCOUNTS a project rotates through
 * when its primary account is limited. Members carry a rotation `priority`
 * (lower = higher priority / earlier in rotation).
 *
 * Members used to be agent profiles; they are accounts as of
 * [remote-dev-n4x4.6] — rotation swaps the injected `CLAUDE_CODE_OAUTH_TOKEN`,
 * not the config dir. The port/table names are retained so the diff stays
 * legible; only the member identity changed.
 */

export interface PoolEntry {
  accountId: string;
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

  /**
   * A single pool, but only if it belongs to `userId`. Returns null when the
   * pool does not exist or is owned by someone else — the ownership gate for
   * pool routes (never leaks another user's pool).
   */
  getPool(poolId: string, userId: string): Promise<PoolSummary | null>;

  /** Create a pool; returns the new pool id. */
  createPool(userId: string, name: string): Promise<string>;

  renamePool(poolId: string, name: string): Promise<void>;

  deletePool(poolId: string): Promise<void>;

  /** Add (or upsert) an account into a pool at the given priority. */
  addMember(poolId: string, accountId: string, priority: number): Promise<void>;

  removeMember(poolId: string, accountId: string): Promise<void>;

  setPriority(
    poolId: string,
    accountId: string,
    priority: number
  ): Promise<void>;
}
