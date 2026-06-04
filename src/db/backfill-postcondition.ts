/**
 * Generalizable deploy-time backfill POST-CONDITION verification (remote-dev-6lf3).
 *
 * Background: the PR #338 auto-deploy created the `user_email` table (db:push ran
 * from the origin/master deploy-src) but left it with 0 rows — the
 * `db:backfill-user-emails` step did not take effect on the live DB, yet the
 * deploy still went GREEN. Root cause was orchestrator lag: the HMAC webhook
 * spawned PROJECT_ROOT's copy of `scripts/deploy.ts`, which at that moment
 * predated the backfill wiring, so the backfill step simply did not exist in the
 * orchestrator that executed. The self-healing resolver fallback
 * (`src/lib/user-identity.ts`) then masked the gap, so nothing surfaced it.
 *
 * This module is the durable safety net: a REGISTRY of backfill post-conditions,
 * each asserting an invariant against the LIVE database AFTER migrations run. The
 * deploy invokes the runner (via `scripts/verify-backfills.ts`); any failed
 * post-condition fails the deploy LOUDLY instead of going green. It generalizes —
 * a future backfill registers another entry here rather than relying on the
 * (silently-skippable) backfill step alone.
 *
 * Each check reads through the app DB client (`@/db`), which resolves the DB
 * purely from env (DATABASE_URL > RDV_DATA_DIR/sqlite.db > ~/.remote-dev/sqlite.db
 * — never cwd-relative; see `src/lib/paths.ts`). So when run from the deploy-src
 * worktree with the same HOME/RDV_DATA_DIR the live server uses, it inspects the
 * SAME live DB the server serves.
 */
import { execute } from "./index";

/** Result of evaluating a single backfill post-condition. */
export interface PostconditionResult {
  /** True when the invariant holds against the live DB. */
  ok: boolean;
  /** Human-readable detail for the deploy log (counts, offending ids, etc.). */
  detail: string;
}

/** A named, deploy-time-verified backfill invariant. */
export interface BackfillPostcondition {
  /** Stable id (matches the `db:*` script that performs the backfill). */
  name: string;
  /** One-line description of the invariant being asserted. */
  description: string;
  /** Evaluate the invariant against the live DB. Must not throw for "false". */
  check: () => Promise<PostconditionResult>;
}

/**
 * Post-condition for `db:backfill-user-emails`: EVERY user with a non-null email
 * must have a matching `user_email` row (the index the multi-email resolver reads
 * instead of `user.email`). This is exactly the invariant that silently broke on
 * the #338 deploy.
 *
 * Implemented as a single `NOT EXISTS` count so it is O(1) round-trips and works
 * identically on SQLite and Postgres (the table/column names are shared). The
 * quoted `"user"` table name is required on both backends (reserved word).
 */
export async function checkUserEmailBackfill(): Promise<PostconditionResult> {
  // Aggregate everything in one pass on the DB (O(1) memory on the live DB —
  // never materializes the user set client-side): total users-with-email for the
  // log line, plus how many are MISSING a matching user_email row.
  const counts = await execute(
    `SELECT
        count(*) AS total,
        count(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1 FROM user_email ue
             WHERE ue.user_id = u.id
               AND ue.email = u.email
          )
        ) AS missing
       FROM "user" u
      WHERE u.email IS NOT NULL`,
  );
  const row = counts.rows[0] as
    | { total?: unknown; missing?: unknown }
    | undefined;
  const total = Number(row?.total ?? 0);
  const missingCount = Number(row?.missing ?? 0);

  if (missingCount > 0) {
    return {
      ok: false,
      detail:
        `${missingCount} of ${total} users with an email are MISSING a ` +
        `matching user_email row — db:backfill-user-emails did not take effect on the live DB`,
    };
  }
  return {
    ok: true,
    detail: `all ${total} users with an email have a matching user_email row`,
  };
}

/**
 * The registry of post-conditions verified after migrations on every deploy.
 * Add a new entry here when a new backfill ships so it gets the same loud,
 * deploy-failing guard rather than relying on the silently-skippable step.
 */
export const BACKFILL_POSTCONDITIONS: BackfillPostcondition[] = [
  {
    name: "db:backfill-user-emails",
    description:
      "every user with an email has a primary user_email resolution row",
    check: checkUserEmailBackfill,
  },
];

/** Aggregate outcome of running every registered post-condition. */
export interface VerifyBackfillsResult {
  ok: boolean;
  results: Array<{ name: string } & PostconditionResult>;
}

/**
 * Run every registered post-condition against the live DB. A check that THROWS
 * is treated as a failure (e.g. the table is missing because db:push silently
 * did not run) — the safe direction, since the whole point is to fail loud
 * rather than serve with a broken invariant.
 */
export async function verifyBackfills(
  postconditions: BackfillPostcondition[] = BACKFILL_POSTCONDITIONS,
): Promise<VerifyBackfillsResult> {
  const results: Array<{ name: string } & PostconditionResult> = [];
  for (const pc of postconditions) {
    try {
      const r = await pc.check();
      results.push({ name: pc.name, ...r });
    } catch (error) {
      results.push({
        name: pc.name,
        ok: false,
        detail: `post-condition threw: ${String(error)}`,
      });
    }
  }
  return { ok: results.every((r) => r.ok), results };
}
