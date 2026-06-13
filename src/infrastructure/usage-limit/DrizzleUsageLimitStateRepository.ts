/**
 * DrizzleUsageLimitStateRepository - Drizzle implementation of the
 * UsageLimitStateRepository port over `claude_usage_limit_state`.
 *
 * Maps the row's 5h/7d percent + reset columns into domain UsageWindows and
 * the row's status/source/timestamps into a LimitState. The write path honors
 * the `onlyIfNewer` staleness guard by comparing the stored `lastCheckedAt`.
 *
 * Note on userId: the domain LimitState is keyed by profileId and does NOT
 * carry a userId, but the row requires one (notNull). We resolve it from the
 * owning `agent_profile` on first insert; subsequent upserts never touch the
 * userId column.
 */

import { db } from "@/db";
import { claudeUsageLimitStates, agentProfiles } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { LimitState } from "@/domain/value-objects/LimitState";
import { UsageWindow } from "@/domain/value-objects/UsageWindow";
import type { UsageLimitStateRepository } from "@/application/ports/UsageLimitStateRepository";
import type {
  ClaudeLimitStatus,
  UsageDetectionSource,
} from "@/types/claude-limits";
import { createLogger } from "@/lib/logger";

const log = createLogger("UsageLimitStateRepo");

type Row = typeof claudeUsageLimitStates.$inferSelect;

export class DrizzleUsageLimitStateRepository
  implements UsageLimitStateRepository
{
  async findByProfileId(profileId: string): Promise<LimitState | null> {
    const row = await db.query.claudeUsageLimitStates.findFirst({
      where: eq(claudeUsageLimitStates.profileId, profileId),
    });
    return row ? rowToLimitState(row) : null;
  }

  async findManyByProfileIds(ids: string[]): Promise<Map<string, LimitState>> {
    const out = new Map<string, LimitState>();
    if (ids.length === 0) return out;
    const rows = await db.query.claudeUsageLimitStates.findMany({
      where: inArray(claudeUsageLimitStates.profileId, ids),
    });
    for (const row of rows) {
      out.set(row.profileId, rowToLimitState(row));
    }
    return out;
  }

  async upsert(
    state: LimitState,
    opts?: { onlyIfNewer?: Date }
  ): Promise<boolean> {
    const profileId = state.getProfileId();

    const existing = await db.query.claudeUsageLimitStates.findFirst({
      where: eq(claudeUsageLimitStates.profileId, profileId),
      columns: { profileId: true, userId: true, lastCheckedAt: true },
    });

    // Staleness guard: a strictly-newer stored observation already won, so this
    // write is dropped — report `false` so the caller doesn't act on it.
    if (
      opts?.onlyIfNewer &&
      existing?.lastCheckedAt &&
      existing.lastCheckedAt.getTime() > opts.onlyIfNewer.getTime()
    ) {
      return false;
    }

    const set = limitStateToColumns(state);

    if (existing) {
      await db
        .update(claudeUsageLimitStates)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(claudeUsageLimitStates.profileId, profileId));
      return true;
    }

    // First insert: resolve the owning userId from the profile row.
    const userId = await this.resolveUserId(profileId);
    if (!userId) {
      log.warn("Skipping usage-limit upsert: profile has no owner row", {
        profileId,
      });
      return false;
    }

    await db
      .insert(claudeUsageLimitStates)
      .values({ profileId, userId, ...set })
      .onConflictDoUpdate({
        target: claudeUsageLimitStates.profileId,
        set: { ...set, updatedAt: new Date() },
      });
    return true;
  }

  async listForUser(userId: string): Promise<LimitState[]> {
    const rows = await db.query.claudeUsageLimitStates.findMany({
      where: eq(claudeUsageLimitStates.userId, userId),
    });
    return rows.map(rowToLimitState);
  }

  private async resolveUserId(profileId: string): Promise<string | null> {
    const profile = await db.query.agentProfiles.findFirst({
      where: eq(agentProfiles.id, profileId),
      columns: { userId: true },
    });
    return profile?.userId ?? null;
  }
}

/** Build the domain LimitState from a DB row. */
function rowToLimitState(row: Row): LimitState {
  const windows: UsageWindow[] = [];
  const w5h = makeWindow("5h", row.window5hPct, row.resetAt5h);
  if (w5h) windows.push(w5h);
  const w7d = makeWindow("7d", row.window7dPct, row.resetAt7d);
  if (w7d) windows.push(w7d);

  // api_key (rate/credit) accounts carry no 5h/7d window — their reset lands in
  // `effectiveResetAt` only. Without rebuilding a window here, a limited api_key
  // row would round-trip as "limited with no reset" (permanently unavailable
  // until cleared), defeating "available again when the rate window passes".
  // Reconstruct an `org` window from `effectiveResetAt` when no rolling window
  // exists so `isAvailableNow` frees the account at its rate reset. [remote-dev-1kt5]
  if (windows.length === 0 && row.effectiveResetAt instanceof Date) {
    windows.push(UsageWindow.create("org", 100, row.effectiveResetAt));
  }

  const source = (row.detectionSource as UsageDetectionSource | null) ?? null;
  const isLimited = (row.limitStatus as ClaudeLimitStatus) === "limited";

  return isLimited
    ? LimitState.limited(row.profileId, {
        windows,
        source,
        lastCheckedAt: row.lastCheckedAt ?? null,
      })
    : LimitState.available(row.profileId, {
        windows,
        source,
        lastCheckedAt: row.lastCheckedAt ?? null,
      });
}

/** A window exists only when at least one dimension is recorded. */
function makeWindow(
  duration: "5h" | "7d",
  pct: number | null,
  resetAt: Date | null
): UsageWindow | null {
  const hasPct = typeof pct === "number";
  const hasReset = resetAt instanceof Date;
  if (!hasPct && !hasReset) return null;
  return UsageWindow.create(
    duration,
    hasPct ? (pct as number) : 100,
    hasReset ? resetAt : null
  );
}

/**
 * The mutable column set shared by insert + update (excludes the keys).
 * Maps directly from the shared {@link LimitState.toSnapshot} projection so the
 * `limitStatus` rule + 5h/7d lookup live in one place (the column names already
 * match the snapshot field names).
 */
function limitStateToColumns(state: LimitState): {
  limitStatus: ClaudeLimitStatus;
  window5hPct: number | null;
  window7dPct: number | null;
  resetAt5h: Date | null;
  resetAt7d: Date | null;
  effectiveResetAt: Date | null;
  detectionSource: UsageDetectionSource | null;
  lastCheckedAt: Date | null;
} {
  const snap = state.toSnapshot();
  return {
    limitStatus: snap.limitStatus,
    window5hPct: snap.window5hPct,
    window7dPct: snap.window7dPct,
    resetAt5h: snap.resetAt5h,
    resetAt7d: snap.resetAt7d,
    effectiveResetAt: snap.effectiveResetAt,
    detectionSource: snap.detectionSource,
    lastCheckedAt: snap.lastCheckedAt,
  };
}
