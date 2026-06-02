/**
 * Next.js instrumentation — runs once when the Supervisor server starts.
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Three jobs, all guarded to the Node runtime (the Edge runtime cannot import
 * the libsql client):
 *   1. FAIL-CLOSED in production if NEITHER Cloudflare Access NOR native OIDC is
 *      configured — otherwise `resolveAuthenticatedEmail` would trust
 *      SUPERVISOR_ADMIN_EMAIL and every request would be admin. Refuse to start
 *      unless the explicit escape hatch SUPERVISOR_ALLOW_INSECURE_AUTH=1 is set
 *      (testing only).
 *   2. MIGRATE-ON-BOOT: apply the committed Drizzle migrations so a fresh PVC
 *      gets every table (existing supervisor tables + the NextAuth identity
 *      tables). Runs BEFORE the admin seed (which writes to supervisor_user).
 *   3. Seed the first admin user from SUPERVISOR_ADMIN_EMAIL (spec §6.2) so the
 *      dashboard is reachable on a fresh database.
 *
 * NOTE: `register()` runs at server START, not at `next build` — so the prod
 * guard never trips a CI build (vitest/`next build` don't call it).
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { createLogger } = await import("@/lib/logger");
  const log = createLogger("Startup");

  // (1) Production fail-closed guard. The Supervisor is safe to boot in prod if
  // it has at least ONE real auth path:
  //   - Cloudflare Access (both AUD and TEAM present), OR
  //   - native OIDC (issuer + clientId + clientSecret + AUTH_SECRET present).
  // With neither, the only identity source is the SUPERVISOR_ADMIN_EMAIL
  // fallback, which would make every request admin — so we refuse to start.
  const cfConfigured = Boolean(
    process.env.SUPERVISOR_CF_ACCESS_AUD &&
      process.env.SUPERVISOR_CF_ACCESS_TEAM,
  );
  const oidcConfigured = Boolean(
    process.env.SUPERVISOR_OIDC_ISSUER &&
      process.env.SUPERVISOR_OIDC_CLIENT_ID &&
      process.env.SUPERVISOR_OIDC_CLIENT_SECRET &&
      process.env.AUTH_SECRET,
  );
  if (
    process.env.NODE_ENV === "production" &&
    !cfConfigured &&
    !oidcConfigured &&
    process.env.SUPERVISOR_ALLOW_INSECURE_AUTH !== "1"
  ) {
    log.error(
      "FATAL: production without CF Access or OIDC configured; refusing to start",
      {},
    );
    process.exit(1);
  }

  // (2) Migrate-on-boot. A fresh DB MUST get all tables before anything reads or
  // writes them. `runMigrations` logs + rethrows on hard failure, so a broken
  // migrate fails the boot loudly rather than serving a tableless app.
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations();

  const adminEmail = process.env.SUPERVISOR_ADMIN_EMAIL;
  if (!adminEmail) {
    log.warn(
      "SUPERVISOR_ADMIN_EMAIL is not set — no admin seeded. The dashboard will be inaccessible until an admin exists.",
    );
    return;
  }

  try {
    const { db } = await import("@/db");
    const { supervisorUser } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const existing = await db.query.supervisorUser.findFirst({
      where: eq(supervisorUser.email, adminEmail),
    });
    if (existing) {
      // Ensure the configured admin email keeps admin rights even if its role
      // was lowered, so an operator can't lock the configured admin out.
      if (existing.role !== "admin") {
        await db
          .update(supervisorUser)
          .set({ role: "admin", updatedAt: new Date() })
          .where(eq(supervisorUser.id, existing.id));
        log.info("Restored admin role for configured admin", {
          email: adminEmail,
        });
      }
      return;
    }

    await db.insert(supervisorUser).values({ email: adminEmail, role: "admin" });
    log.info("Seeded first admin user", { email: adminEmail });
  } catch (error) {
    log.error("Admin seed failed", { error: String(error) });
  }
}
