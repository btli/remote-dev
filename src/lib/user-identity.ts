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
 * Resolve an email address to the owning user id.
 *
 * Resolution order:
 *  1. The `user_email` index (the all-emails index — primary AND secondary
 *     emails resolve identically here once present).
 *  2. SELF-HEALING FALLBACK to `user.email`: a legacy `user` row that predates
 *     this feature (or whose backfill silently failed) has no `user_email` row,
 *     so step 1 misses. Rather than treat that user as unknown — which would
 *     make `getOrCreateUserByEmail` attempt a re-create and hit the `user.email`
 *     UNIQUE constraint, 500-ing the user during the transition — we look the
 *     email up directly in `user`. On a hit we lazily create the missing
 *     primary `user_email` row (idempotent / onConflictDoNothing) so the next
 *     resolution takes the fast path, then return that user id.
 *
 * Returns `null` only when NEITHER `user_email` NOR `user.email` matches.
 *
 * Net effect: resolution is correct regardless of backfill state — the deploy/
 * boot backfill becomes an optimization (avoids the lazy heal on first touch),
 * not a load-bearing prerequisite for correctness.
 */
export async function resolveUserIdByEmail(
  email: string,
  handle: UserIdentityDb = db as unknown as UserIdentityDb
): Promise<string | null> {
  const row = await handle.query.userEmails.findFirst({
    where: eq(userEmails.email, email),
    columns: { userId: true },
  });
  if (row) return row.userId;

  // Self-heal: fall back to the canonical `user.email` for legacy/unbackfilled
  // rows. eq(users.email, email) is backed by the UNIQUE index on user.email.
  const legacyUser = await handle.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (!legacyUser) return null;

  await ensurePrimaryUserEmail(legacyUser.id, email, handle);
  log.info("Self-healed missing user_email index row", { userId: legacyUser.id });
  return legacyUser.id;
}

/**
 * Resolve an email to its user, creating the user (and its primary
 * `user_email` row) when the email is not yet known.
 *
 * Resolution order (via `findUserByAnyEmail` → `resolveUserIdByEmail`, so it
 * inherits the self-healing `user.email` fallback):
 *  1. Look the email up in `user_email`; if found, return that user.
 *  2. Else fall back to `user.email` — a legacy/unbackfilled user is RESOLVED
 *     (and its missing `user_email` row lazily healed), never re-created.
 *  3. Only when neither matches do we create a `user` row (email as the
 *     canonical/primary email) AND a matching `user_email` row
 *     (`isPrimary = true`) atomically.
 *
 * `presetId` lets callers preserve an externally-issued id (e.g. the id baked
 * into a still-valid NextAuth JWT) so creating the missing row does not
 * invalidate the caller's session.
 *
 * Fail-safe on races/uniqueness: both `user.email` and `user_email.email` are
 * UNIQUE, so a concurrent insert of the same email cannot silently reassign it
 * to a different user — the loser re-reads and returns the winning user.
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
    // Tracks whether THIS call actually minted the user row (vs. losing the
    // in-transaction race recheck). Only a true mint triggers the one-time
    // default-project seed below — never an existing user, never a race loser.
    let createdNewUser = false;
    const user = await db.transaction(async (tx) => {
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

      createdNewUser = true;
      log.info("Created user via email resolution", { userId: created.id });
      return { id: created.id, email: created.email, name: created.name };
    });

    // First-run onboarding: give a brand-new user a usable default project so
    // terminal creation works out of the box (a fresh instance seeds no
    // project at boot — boot runs before any user exists). Runs AFTER the user
    // transaction commits (the project FK references the now-committed user
    // row), only on a genuine first-time mint, and is itself idempotent +
    // non-fatal — a seed failure must never block login. Lazy-imported to keep
    // this module (loaded very early by auth) free of the project-service /
    // DI-container import graph at eval time. (remote-dev-bxcn)
    if (createdNewUser) {
      const { ensureDefaultProjectForUser } = await import("@/lib/ensure-default-project");
      await ensureDefaultProjectForUser(user.id);
    }

    return user;
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
