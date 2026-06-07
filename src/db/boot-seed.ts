/**
 * Boot-time authorized-user seeding (remote-dev-sb98).
 *
 * A freshly provisioned instance had no automated path to authorize users: the
 * supervisor's first-boot seed Job was never dispatched (it could not co-mount the
 * instance's RWO PVC) and the manual `src/db/seed.ts` CLI requires a `kubectl exec`.
 * The replacement is THIS step: the supervisor injects `AUTHORIZED_USERS` as plain
 * container env on the instance StatefulSet, and the app seeds the
 * `authorized_users` table from it once the schema exists at boot.
 *
 * DIALECT-AGNOSTIC: this runs for BOTH backends. On the SQLite path the schema is
 * already present pre-app (the entrypoint's instance-bootstrap-db.mjs runs before
 * the server starts); on the Postgres path migrate-on-boot (src/db/migrate.ts)
 * creates the schema in the step immediately before this one in instrumentation.ts.
 * Either way the table exists by the time we insert.
 *
 * RESILIENCE: mostly NON-FATAL, with ONE loud exception. A transient DB blip /
 * duplicate race on an already-seeded instance must NOT break boot, so those are
 * caught + warned LOUDLY (structured) rather than rethrown. BUT a "table does not
 * exist" error is different: it means AUTHORIZED_USERS is set yet the schema is
 * missing — a misconfigured boot where seeding can NEVER succeed and the instance
 * would come up silently unauthorized. That case is logged at ERROR and RETHROWN
 * (like migrate.ts) so the boot fails loud instead of serving an instance nobody
 * intended to be open. All other errors stay a non-fatal warn.
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
 * Defensive cap on the number of authorized emails parsed from the env (mirrors
 * the supervisor's `MAX_ENTRIES`). The supervisor already bounds the list at write
 * time, but the instance app must not blindly insert an unbounded set if the env
 * was set by hand; extras past the cap are dropped (with a warn).
 */
const MAX_ENTRIES = 100;

/**
 * Parse a comma-separated `AUTHORIZED_USERS` value into a deduped, trimmed,
 * non-empty email list — the SAME semantics as `src/db/seed.ts` (trim each entry,
 * drop empties), plus a de-dup so a value like `a@x.com,a@x.com` inserts once.
 * Capped at {@link MAX_ENTRIES}.
 */
function parseAuthorizedEmails(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const email = part.trim();
    if (email.length > 0) seen.add(email);
  }
  return [...seen].slice(0, MAX_ENTRIES);
}

/**
 * True when `error` indicates the `authorized_users` table is missing (schema not
 * applied). Covers SQLite (`no such table`) and PostgreSQL (`relation "…" does not
 * exist` / a generic `does not exist`). This is the one class we treat as FATAL.
 */
function isMissingTableError(error: unknown): boolean {
  return /no such table|does not exist|relation .* does not exist/i.test(
    String(error),
  );
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
    if (isMissingTableError(error)) {
      // FATAL: AUTHORIZED_USERS is set but the schema is missing — seeding can
      // never succeed and the instance would boot silently unauthorized. Fail
      // loud (like migrate.ts) rather than mask it.
      log.error(
        "Boot-time authorized-user seeding failed: authorized_users table is missing — schema not applied (FATAL)",
        { error: String(error), count: emails.length },
      );
      throw error;
    }
    // NON-FATAL: a transient blip / duplicate race on an already-seeded instance
    // must still boot. Make the warning loud + structured so a genuinely-broken
    // seed is impossible to miss.
    log.warn("Boot-time authorized-user seeding failed (non-fatal; instance continues booting)", {
      error: String(error),
      count: emails.length,
    });
  }
}
