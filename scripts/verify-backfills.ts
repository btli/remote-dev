#!/usr/bin/env bun
/**
 * CLI entry: verify deploy-time backfill POST-CONDITIONS against the live DB
 * (remote-dev-6lf3).
 *
 * Invoked by `scripts/deploy.ts` immediately AFTER migrations + backfills run.
 * Exits NON-ZERO if any registered post-condition fails, so the deploy aborts
 * loudly instead of going green with a silently-skipped backfill (the exact
 * #338 failure: `user_email` table created but left empty).
 *
 * Runs from the deploy-src worktree (origin/master code) but inspects the SAME
 * live DB the server serves, because the DB target resolves purely from env
 * (DATABASE_URL > RDV_DATA_DIR/sqlite.db > ~/.remote-dev/sqlite.db), not cwd.
 *
 * Run manually with: bun run db:verify-backfills
 */
import { verifyBackfills } from "../src/db/backfill-postcondition";

verifyBackfills()
  .then((outcome) => {
    for (const r of outcome.results) {
      const status = r.ok ? "OK" : "FAIL";
      // Human-readable per-check line (mirrors the other db:* scripts' stdout).
      console.log(`[backfill-verify] ${status} ${r.name}: ${r.detail}`);
    }
    if (!outcome.ok) {
      console.error(
        "❌ backfill post-condition check FAILED — a backfill did not take effect on the live DB",
      );
      process.exit(1);
    }
    console.log("✅ all backfill post-conditions satisfied");
    process.exit(0);
  })
  .catch((error) => {
    // A thrown runner is itself a failure (e.g. DB unreachable) — fail loud.
    console.error("❌ backfill verification crashed:", error);
    process.exit(1);
  });
