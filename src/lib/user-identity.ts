/**
 * User identity resolution by email (multi-email support).
 *
 * A single user account can own multiple email addresses. The `user_email`
 * table is the resolution index: it maps EVERY email a user owns — including
 * their primary `user.email` — to their `user.id`. Every
 * identity-resolution-by-email path in the app (Cloudflare Access, the
 * credentials provider, the adapter's createUser, mobile auth) routes through
 * the helpers here so the resolution stays consistent and a secondary email
 * resolves to the owning account instead of minting a new empty one.
 *
 * `user.email` remains the canonical/display email; this module never changes
 * that semantics — it only adds the all-emails resolution index alongside it.
 */
import { db } from "@/db";
import { users, userEmails } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createLogger } from "@/lib/logger";

const log = createLogger("UserIdentity");

/**
 * Minimal structural view of the Drizzle db/tx handle this module needs. Using
 * a narrow interface (rather than the concrete `LibSQLDatabase` type) keeps the
 * helpers usable both with the module-level `db` and inside a
 * `db.transaction((tx) => …)` callback, and keeps them trivially mockable in
 * unit tests without standing up a real database.
 */
export interface UserIdentityDb {
  query: {
    userEmails: {
      findFirst: (args: {
        where: unknown;
        columns?: Record<string, boolean>;
      }) => Promise<{ userId: string } | undefined>;
    };
    users: {
      findFirst: (args: { where: unknown }) => Promise<DbUser | undefined>;
    };
  };
  insert: (table: unknown) => {
    values: (values: unknown) => {
      onConflictDoNothing: () => Promise<unknown>;
      returning: () => Promise<DbUser[]>;
    };
  };
}

export interface DbUser {
  id: string;
  email: string | null;
  name: string | null;
}

/**
 * Resolve an email address to the owning user id via the `user_email` index.
 * Returns `null` when the email is not registered to any user.
 *
 * This is the single read-side resolver: it intentionally consults ONLY
 * `user_email` (which contains every user's primary email after backfill), so
 * both primary and secondary emails resolve identically.
 */
export async function resolveUserIdByEmail(
  email: string,
  handle: UserIdentityDb = db as unknown as UserIdentityDb
): Promise<string | null> {
  const row = await handle.query.userEmails.findFirst({
    where: eq(userEmails.email, email),
    columns: { userId: true },
  });
  return row?.userId ?? null;
}

/**
 * Resolve an email to its user, creating the user (and its primary
 * `user_email` row) when the email is not yet known.
 *
 * Resolution order:
 *  1. Look the email up in `user_email`; if found, return that user.
 *  2. Otherwise create a `user` row (email as the canonical/primary email) AND
 *     a matching `user_email` row (`isPrimary = true`) atomically.
 *
 * `presetId` lets callers preserve an externally-issued id (e.g. the id baked
 * into a still-valid NextAuth JWT) so creating the missing row does not
 * invalidate the caller's session.
 *
 * Fail-safe on races/uniqueness: `user_email.email` is UNIQUE, so a concurrent
 * insert of the same email cannot silently reassign it to a different user —
 * the loser re-reads and returns the winning user.
 */
export async function getOrCreateUserByEmail(
  email: string,
  name?: string | null,
  presetId?: string
): Promise<DbUser> {
  // Fast path: already known.
  const existing = await findUserByAnyEmail(email);
  if (existing) return existing;

  try {
    return await db.transaction(async (tx) => {
      // Re-check inside the transaction to collapse a race where two callers
      // both missed on the fast path.
      const recheck = await findUserByAnyEmail(email, tx as unknown as UserIdentityDb);
      if (recheck) return recheck;

      const [created] = await tx
        .insert(users)
        .values({
          ...(presetId ? { id: presetId } : {}),
          email,
          name: name ?? email.split("@")[0],
        })
        .returning();

      await tx
        .insert(userEmails)
        .values({ userId: created.id, email, isPrimary: true })
        .onConflictDoNothing();

      log.info("Created user via email resolution", { userId: created.id });
      return { id: created.id, email: created.email, name: created.name };
    });
  } catch (error) {
    // A UNIQUE violation here means the email was claimed concurrently (either
    // a parallel create, or the email already belonged to another user). Re-read
    // through the index and return the owner — never silently reassign.
    const owner = await findUserByAnyEmail(email);
    if (owner) {
      log.warn("Email already claimed during create; returning existing owner", {
        userId: owner.id,
      });
      return owner;
    }
    log.error("Failed to get-or-create user by email", { error: String(error) });
    throw error;
  }
}

/**
 * Ensure a primary `user_email` row exists for an already-created user.
 * Idempotent: relies on the UNIQUE(email) constraint, so a second call (or a
 * concurrent one) is a no-op. Used by the NextAuth adapter's `createUser`
 * override, where the `user` row is inserted by the adapter itself.
 */
export async function ensurePrimaryUserEmail(
  userId: string,
  email: string,
  handle: UserIdentityDb = db as unknown as UserIdentityDb
): Promise<void> {
  await handle
    .insert(userEmails)
    .values({ userId, email, isPrimary: true })
    .onConflictDoNothing();
}

/**
 * Look an email up via the `user_email` index and hydrate the owning `user`
 * row. Returns `null` when unknown.
 */
async function findUserByAnyEmail(
  email: string,
  handle: UserIdentityDb = db as unknown as UserIdentityDb
): Promise<DbUser | null> {
  const userId = await resolveUserIdByEmail(email, handle);
  if (!userId) return null;
  const user = await handle.query.users.findFirst({
    where: eq(users.id, userId),
  });
  return user ?? null;
}
