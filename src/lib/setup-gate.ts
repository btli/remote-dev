import { db } from "@/db";
import { getAuthSession } from "@/lib/auth-utils";
import { createLogger } from "@/lib/logger";

const log = createLogger("SetupGate");

/**
 * Authorization gate for the first-run setup wizard routes (`/api/setup/*`).
 *
 * These routes pre-date any user/session — the wizard must be reachable on a
 * brand-new install before authentication exists. But once setup completes they
 * disclose system info (platform, dependency versions, stored config paths/ports)
 * and let a caller rewrite the setup config, so they must not stay open forever.
 *
 * In SCOPED instance mode (a standalone pod under `RDV_BASE_PATH`) the proxy's
 * `/api` gate is only session-cookie PRESENCE (see the rationale block in
 * `src/proxy.ts`), so any garbage cookie passes the proxy and route-level auth is
 * the real boundary. This helper IS that boundary for `/api/setup/*`.
 *
 * Returns `true` when EITHER:
 *  - first-run setup is NOT yet complete (no `setup_config` row, or `!isComplete`)
 *    — so the wizard works before any user/session exists; OR
 *  - the caller has a real authenticated session (`getAuthSession()` resolves a
 *    user with an `id`). This runs in the Node route realm, where the NextAuth /
 *    CF-identity crypto validation actually works (unlike the proxy realm in
 *    scoped mode).
 *
 * Fails CLOSED: on an unexpected DB error we treat setup as complete (i.e. require
 * auth) rather than leaving the routes open.
 *
 * remote-dev-2rob.
 */
export async function isSetupRequestAllowed(): Promise<boolean> {
  let setupComplete: boolean;
  try {
    const config = await db.query.setupConfig.findFirst();
    setupComplete = !!config?.isComplete;
  } catch (error) {
    // Fail closed: if we cannot determine setup state, assume it is complete and
    // require a real session, so a transient DB error never opens these routes.
    log.warn("Setup-state lookup failed; requiring auth (fail-closed)", {
      error: String(error),
    });
    setupComplete = true;
  }

  // Before first-run completes, the wizard must work without a session.
  if (!setupComplete) {
    return true;
  }

  // After setup is complete, only an authenticated caller may proceed.
  const session = await getAuthSession();
  return !!session?.user?.id;
}
