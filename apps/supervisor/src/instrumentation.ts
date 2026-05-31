/**
 * Next.js instrumentation — runs once when the Supervisor server starts.
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Two jobs, both guarded to the Node runtime (the Edge runtime cannot import
 * the libsql client):
 *   1. FAIL-CLOSED in production if Cloudflare Access is not configured —
 *      otherwise `resolveAuthenticatedEmail` would trust SUPERVISOR_ADMIN_EMAIL
 *      and every request would be admin. Refuse to start unless the explicit
 *      escape hatch SUPERVISOR_ALLOW_INSECURE_AUTH=1 is set (testing only).
 *   2. Seed the first admin user from SUPERVISOR_ADMIN_EMAIL (spec §6.2) so the
 *      dashboard is reachable on a fresh database.
 *
 * NOTE: `register()` runs at server START, not at `next build` — so the prod
 * guard never trips a CI build (vitest/`next build` don't call it).
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { createLogger } = await import("@/lib/logger");
  const log = createLogger("Startup");

  // (1) Production fail-closed guard. Mirror cf-access.isCfAccessConfigured():
  // both AUD and TEAM must be present. Without it, the auth fallback would make
  // everyone admin in prod.
  const cfConfigured = Boolean(
    process.env.SUPERVISOR_CF_ACCESS_AUD &&
      process.env.SUPERVISOR_CF_ACCESS_TEAM,
  );
  if (
    process.env.NODE_ENV === "production" &&
    !cfConfigured &&
    process.env.SUPERVISOR_ALLOW_INSECURE_AUTH !== "1"
  ) {
    log.error(
      "FATAL: production without CF Access configured; refusing to start",
      {},
    );
    process.exit(1);
  }

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
