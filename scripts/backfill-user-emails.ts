#!/usr/bin/env bun
/**
 * CLI entry for the `user_email` backfill (remote-dev multi-email support).
 *
 * Invoked on the main-app deploy by `scripts/deploy.ts` immediately after
 * `bun run db:push` creates the `user_email` table. Idempotent — safe to run on
 * every deploy. See `src/db/backfill-user-emails.ts` for the logic.
 *
 * Run manually with: bun run db:backfill-user-emails
 */
import { backfillUserEmails } from "../src/db/backfill-user-emails";

backfillUserEmails()
  .then((result) => {
    // Mirror the other migration scripts' human-readable stdout summary.
    console.log(
      `✅ user_email backfill: ${result.created} created, ` +
        `${result.alreadyPresent} already present (${result.scanned} users scanned)`
    );
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ user_email backfill failed:", error);
    process.exit(1);
  });
