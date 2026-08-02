/**
 * DrizzleUsageLimitWindowRepository - Drizzle implementation of the
 * UsageLimitWindowRepository port over `claude_usage_limit_window`.
 * [remote-dev-n4x4.2]
 *
 * Rows map 1:1 onto the port's {@link UsageLimitWindow}; `kind`, `group` and
 * `severity` are stored verbatim (open string sets — an unrecognized upstream
 * value must round-trip, not be dropped).
 *
 * `replaceForAccount` is a delete-then-insert inside ONE transaction: an
 * account's windows are always exactly what the last poll reported, so a window
 * that disappears upstream cannot linger.
 *
 * Two concurrency protections ride on that write:
 *   - A UNIQUE index on (account_id, kind, scope_model_key) — the logical key,
 *     with NULL `scope_model` folded to "" so ONE index is portable across
 *     SQLite and PostgreSQL. Without it, two polls that each see an empty table
 *     both delete nothing and both insert, silently producing the union.
 *   - An `observed_at` staleness guard read inside the transaction, so a slow
 *     response finishing last cannot overwrite a newer one.
 *
 * Note on userId: the port speaks accounts, but the row requires a userId
 * (notNull). It is resolved from the owning `claude_account` on each replace;
 * an account with no owner row is a no-op (returns false) rather than a throw.
 */

import { db } from "@/db";
import { claudeUsageLimitWindows, claudeAccounts } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import type {
  UsageLimitWindow,
  UsageLimitWindowRepository,
} from "@/application/ports/UsageLimitWindowRepository";
import { createLogger } from "@/lib/logger";

const log = createLogger("UsageLimitWindowRepo");

type Row = typeof claudeUsageLimitWindows.$inferSelect;

export class DrizzleUsageLimitWindowRepository
  implements UsageLimitWindowRepository
{
  async replaceForAccount(
    accountId: string,
    windows: UsageLimitWindow[],
    observedAt: Date
  ): Promise<boolean> {
    const userId = await this.resolveUserId(accountId);
    if (!userId) {
      log.warn("Skipping usage-window replace: account has no owner row", {
        accountId,
      });
      return false;
    }

    const now = new Date();
    // De-dupe on the logical key before hitting the unique index: a malformed
    // upstream body repeating a (kind, scopeModel) pair must not fail the whole
    // write. Last occurrence wins, matching "the response is the truth".
    const byKey = new Map<string, UsageLimitWindow>();
    for (const w of windows) {
      byKey.set(`${w.kind}\u0000${w.scopeModel ?? ""}`, w);
    }

    const values = [...byKey.values()].map((w) => ({
      accountId,
      userId,
      kind: w.kind,
      limitGroup: w.group,
      percent: clampPercent(w.percent),
      severity: w.severity,
      resetsAt: w.resetsAt,
      scopeModel: w.scopeModel,
      // NULL folded to "" so the unique index has a NOT NULL column to key on.
      scopeModelKey: w.scopeModel ?? "",
      scopeSurface: w.scopeSurface,
      isActive: w.isActive,
      observedAt,
      createdAt: now,
      updatedAt: now,
    }));

    // Delete + insert in one transaction so a reader never observes a
    // partially-replaced window set, and so the staleness check below cannot
    // race the write it guards.
    let wrote = true;
    await db.transaction(async (tx) => {
      const existing = await tx.query.claudeUsageLimitWindows.findMany({
        where: eq(claudeUsageLimitWindows.accountId, accountId),
        columns: { observedAt: true },
      });

      // Staleness guard: a strictly-newer stored observation already won.
      const newest = existing.reduce<number>(
        (max, row) =>
          row.observedAt instanceof Date
            ? Math.max(max, row.observedAt.getTime())
            : max,
        0
      );
      if (newest > observedAt.getTime()) {
        wrote = false;
        return;
      }

      await tx
        .delete(claudeUsageLimitWindows)
        .where(eq(claudeUsageLimitWindows.accountId, accountId));
      if (values.length > 0) {
        await tx.insert(claudeUsageLimitWindows).values(values);
      }
    });

    if (!wrote) {
      log.debug("Skipped usage-window replace: a newer observation exists", {
        accountId,
      });
      return false;
    }

    log.debug("Replaced usage windows for account", {
      accountId,
      windows: values.length,
    });
    return true;
  }

  async findByAccountId(accountId: string): Promise<UsageLimitWindow[]> {
    const rows = await db.query.claudeUsageLimitWindows.findMany({
      where: eq(claudeUsageLimitWindows.accountId, accountId),
    });
    return rows.map(rowToWindow);
  }

  async findManyByAccountIds(
    ids: string[]
  ): Promise<Map<string, UsageLimitWindow[]>> {
    const out = new Map<string, UsageLimitWindow[]>();
    if (ids.length === 0) return out;

    const rows = await db.query.claudeUsageLimitWindows.findMany({
      where: inArray(claudeUsageLimitWindows.accountId, ids),
    });
    for (const row of rows) {
      const existing = out.get(row.accountId);
      if (existing) existing.push(rowToWindow(row));
      else out.set(row.accountId, [rowToWindow(row)]);
    }
    return out;
  }

  private async resolveUserId(accountId: string): Promise<string | null> {
    const account = await db.query.claudeAccounts.findFirst({
      where: eq(claudeAccounts.id, accountId),
      columns: { userId: true },
    });
    return account?.userId ?? null;
  }
}

/** Map a DB row onto the port's window shape. */
function rowToWindow(row: Row): UsageLimitWindow {
  return {
    kind: row.kind,
    group: row.limitGroup ?? null,
    percent: typeof row.percent === "number" ? row.percent : 0,
    severity: row.severity ?? null,
    resetsAt: row.resetsAt ?? null,
    scopeModel: row.scopeModel ?? null,
    scopeSurface: row.scopeSurface ?? null,
    isActive: row.isActive === true,
    observedAt: row.observedAt ?? null,
  };
}

/**
 * Clamp + round to the 0-100 integer the column holds. PostgreSQL rounds a
 * float on write while SQLite keeps it, so rounding here keeps both dialects
 * storing the same value.
 */
function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 100) return 100;
  return Math.round(value);
}
