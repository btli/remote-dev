/**
 * [remote-dev-1aa5d] Pure merge logic for the client-side agent activity-status
 * cache (used by SessionContext). Extracted so the monotonic ordering rules are
 * unit-testable without rendering the provider.
 *
 * The cache maps sessionId → { status, at } where `at` is the server-arrival
 * epoch ms of the write (null when unknown). Two merge paths:
 *
 *  - {@link mergeActivityStatus} applies a single WS push. A push whose `at` is
 *    strictly OLDER than the cached entry is dropped (late/out-of-order). A push
 *    with no `at` (old servers) always applies, preserving prior behavior.
 *
 *  - {@link reseedActivityStatuses} re-seeds from the authoritative DB rows on
 *    refresh. A DB row only overwrites the cache when its `agentActivityStatusAt`
 *    is newer-or-equal than the cached `at` (or the cache lacks an ordering key
 *    or an entry). This stops a refresh from rolling back a just-pushed status
 *    whose fire-and-forget DB write hasn't landed yet.
 */

export interface ActivityStatusEntry<S extends string = string> {
  status: S;
  at: number | null;
}

export type ActivityStatusCache<S extends string = string> = Record<string, ActivityStatusEntry<S>>;

/**
 * Merge a single WS push into the cache. Returns the same reference when the
 * write is a no-op or is dropped as stale (lets callers skip a re-render).
 */
export function mergeActivityStatus<S extends string>(
  cache: ActivityStatusCache<S>,
  sessionId: string,
  status: S,
  at?: number
): ActivityStatusCache<S> {
  const existing = cache[sessionId];
  const incomingAt = at ?? null;

  // Drop strictly-older out-of-order pushes (only when both have an ordering key).
  if (existing && incomingAt != null && existing.at != null && incomingAt < existing.at) {
    return cache;
  }

  // No-op when status AND ordering key are unchanged.
  if (existing && existing.status === status && incomingAt === existing.at) {
    return cache;
  }

  return { ...cache, [sessionId]: { status, at: incomingAt } };
}

export interface DbActivityRow<S extends string = string> {
  id: string;
  status: S | null;
  /** DB-persisted server-arrival epoch ms (null when none). */
  at: number | null;
}

/**
 * Re-seed the cache from authoritative DB rows. Returns the same reference when
 * nothing changed. `isValid` filters out non-activity status strings.
 */
export function reseedActivityStatuses<S extends string>(
  cache: ActivityStatusCache<S>,
  rows: DbActivityRow<S>[],
  isValid: (status: string) => boolean
): ActivityStatusCache<S> {
  let changed = false;
  const next = { ...cache };
  for (const row of rows) {
    if (!row.status || !isValid(row.status)) continue;
    const cached = next[row.id];
    // Skip when the cached entry is strictly newer than the DB row.
    if (cached && cached.at != null && row.at != null && cached.at > row.at) {
      continue;
    }
    if (cached && cached.status === row.status && cached.at === row.at) {
      continue;
    }
    next[row.id] = { status: row.status, at: row.at };
    changed = true;
  }
  return changed ? next : cache;
}
