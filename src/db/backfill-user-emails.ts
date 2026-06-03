/**
 * Backfill the `user_email` resolution index for pre-existing users.
 *
 * Every `user` row that has an email but no corresponding `user_email` row gets
 * a primary (`isPrimary = true`) row created with that email. This is what lets
 * existing accounts keep resolving by their original email after multi-email
 * support ships (the resolution paths read `user_email`, not `user.email`).
 *
 * Idempotent and safe to run repeatedly:
 *  - We only insert for users missing a primary row (left-join IS NULL), and
 *  - the insert uses `onConflictDoNothing` so the UNIQUE(email) constraint makes
 *    any duplicate a no-op even under concurrent runs.
 *
 * Runs automatically on the main-app deploy via `scripts/deploy.ts`
 * (`db:backfill-user-emails`, invoked right after `db:push`). The slim instance
 * runtime image has no `src/`, so the instance boot path reimplements the same
 * idempotent insert as pure SQL in `scripts/instance-bootstrap-db.mjs`.
 */
import { db } from "./index";
import { users, userEmails } from "./schema";
import { isNotNull } from "drizzle-orm";
import { createLogger } from "@/lib/logger";

const log = createLogger("BackfillUserEmails");

export interface BackfillResult {
  /** Users with a non-null email that were considered. */
  scanned: number;
  /** Primary user_email rows newly created by this run. */
  created: number;
  /** Users that already had a primary row (skipped). */
  alreadyPresent: number;
}

/**
 * Create a primary `user_email` row for every user that has an email but is
 * missing one. Returns a summary; logs it at info level.
 */
export async function backfillUserEmails(): Promise<BackfillResult> {
  // Pull all users with an email plus the set of emails already indexed. The
  // user table is small (one row per human), so loading both and diffing in
  // memory is simpler and clearer than a correlated subquery, and keeps the
  // insert idempotent regardless.
  const allUsers = await db.query.users.findMany({
    where: isNotNull(users.email),
    columns: { id: true, email: true },
  });

  const indexed = await db.query.userEmails.findMany({
    columns: { email: true },
  });
  const indexedEmails = new Set(indexed.map((r) => r.email));

  let created = 0;
  let alreadyPresent = 0;

  for (const u of allUsers) {
    if (!u.email) continue;
    if (indexedEmails.has(u.email)) {
      alreadyPresent++;
      continue;
    }
    // onConflictDoNothing guards against a row inserted by a concurrent run or
    // by a login between the read above and this write.
    await db
      .insert(userEmails)
      .values({ userId: u.id, email: u.email, isPrimary: true })
      .onConflictDoNothing();
    created++;
  }

  const result: BackfillResult = {
    scanned: allUsers.length,
    created,
    alreadyPresent,
  };
  log.info("user_email backfill complete", { ...result });
  return result;
}
