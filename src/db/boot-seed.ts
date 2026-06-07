/**
 * Boot-time authorized-user seeding (remote-dev-sb98).
 *
 * A freshly provisioned instance has no automated path to authorize users: the
 * manual `src/db/seed.ts` CLI is not shipped in the standalone runtime image, and
 * the supervisor's first-boot seed Job was never dispatched (it could not co-mount
 * the instance's RWO PVC). The replacement is THIS step: the supervisor injects
 * `AUTHORIZED_USERS` as plain container env on the instance StatefulSet, and the
 * app seeds the `authorized_users` table from it once the schema exists at boot.
 *
 * DIALECT-AGNOSTIC: this runs for BOTH backends. On the SQLite path the schema is
 * already present pre-app (the entrypoint's instance-bootstrap-db.mjs runs before
 * the server starts); on the Postgres path migrate-on-boot (src/db/migrate.ts)
 * creates the schema in the step immediately before this one in instrumentation.ts.
 * Either way the table exists by the time we insert.
 *
 * RESILIENCE: this is NON-FATAL. An EXISTING instance whose users were already
 * seeded must boot even if this step hiccups (a transient DB blip, a duplicate
 * race), so we catch + warn LOUDLY (structured) rather than rethrow. Contrast
 * with migrate.ts, which DOES rethrow — a failed migrate leaves a tableless app,
 * but a failed re-seed of an already-populated table does not break the instance.
 *
 * IDEMPOTENT: `onConflictDoNothing()` means re-running on every boot is a no-op
 * for already-authorized emails, so this also retro-seeds an EXISTING instance the
 * first time the supervisor adds `AUTHORIZED_USERS` to its spec (one rolling
 * restart) without ever duplicating a row.
 *
 * SECURITY: the authorized emails are not secrets, but the user list is still PII
 * we don't splatter into INFO logs — INFO logs only a COUNT; the emails themselves
 * appear only at DEBUG. (src/db/seed.ts logs them because it's an interactive CLI;
 * this boot path must not.)
 */

import { db } from "./index";
import { authorizedUsers } from "./schema";
import { createLogger } from "@/lib/logger";

const log = createLogger("db/boot-seed");

/**
 * Parse a comma-separated `AUTHORIZED_USERS` value into a deduped, trimmed,
 * non-empty email list — the SAME semantics as `src/db/seed.ts` (trim each entry,
 * drop empties), plus a de-dup so a value like `a@x.com,a@x.com` inserts once.
 */
function parseAuthorizedEmails(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const email = part.trim();
    if (email.length > 0) seen.add(email);
  }
  return [...seen];
}

/**
 * Seed the `authorized_users` table from the `AUTHORIZED_USERS` env var.
 *
 * No-ops UNLESS `AUTHORIZED_USERS` is a non-empty string with at least one
 * non-empty email after parsing — so an instance without it (the common local /
 * single-host case) does NOT touch the DB at all. Inserts via
 * `onConflictDoNothing()` (idempotent). Any failure is caught + warned (never
 * thrown): a re-seed must not break an instance that already has its users.
 */
export async function seedAuthorizedUsersFromEnv(): Promise<void> {
  const raw = process.env.AUTHORIZED_USERS;
  // No-op unless explicitly configured with a non-empty value. (A bare empty
  // string or whitespace-only value is treated as "not configured".)
  if (typeof raw !== "string" || raw.trim() === "") return;

  const emails = parseAuthorizedEmails(raw);
  if (emails.length === 0) return;

  try {
    await db
      .insert(authorizedUsers)
      .values(emails.map((email) => ({ email })))
      .onConflictDoNothing();
    // INFO carries only the COUNT — never the emails (PII). The actual addresses
    // are DEBUG-only.
    log.info("Seeded authorized users from AUTHORIZED_USERS", { count: emails.length });
    log.debug("Authorized-user seed details", { emails });
  } catch (error) {
    // NON-FATAL: an already-seeded instance must still boot. Make the warning
    // loud + structured so a genuinely-broken seed is impossible to miss.
    log.warn("Boot-time authorized-user seeding failed (non-fatal; instance continues booting)", {
      error: String(error),
      count: emails.length,
    });
  }
}
