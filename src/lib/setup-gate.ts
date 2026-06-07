import { db } from "@/db";
import { getAuthSession } from "@/lib/auth-utils";
import { INSTANCE_SLUG } from "@/lib/base-path";
import { createLogger } from "@/lib/logger";

const log = createLogger("SetupGate");

/**
 * Resolve whether the caller has a real authenticated session.
 *
 * Wraps `getAuthSession()` (which does auth + DB work and CAN throw) in a
 * try/catch so a thrown auth/DB error becomes a DENY (false) rather than an
 * unhandled 500 in the route handlers that call the gate outside their own
 * try blocks (remote-dev-2rob, codex Low 1).
 */
export async function hasValidSession(): Promise<boolean> {
  try {
    const session = await getAuthSession();
    return !!session?.user?.id;
  } catch (error) {
    log.warn("Session resolution failed; treating as unauthenticated", {
      error: String(error),
    });
    return false;
  }
}

/**
 * Whether first-run setup is still OPEN — i.e. the wizard may run without a
 * session. True only in UNSCOPED (single-server / local / Electron) mode AND
 * while no completed `setup_config` row exists.
 *
 * SCOPED instance pods (multi-instance under `RDV_BASE_PATH`, `INSTANCE_SLUG`
 * non-empty) have NO first-run wizard — they are provisioned via env/bootstrap
 * and never complete the Electron-oriented setup flow. If we let "setup
 * incomplete" open the routes there, the first-run window would stay open
 * FOREVER on exactly the deployment this issue is about (codex Medium 1). So in
 * scoped mode this always returns false: a real session is required
 * unconditionally.
 *
 * Fails CLOSED: on a DB error we treat setup as complete (return false → require
 * auth) so a transient error never opens these routes.
 *
 * remote-dev-2rob.
 */
export async function isFirstRunOpen(): Promise<boolean> {
  // Scoped instance pods have no first-run wizard — never open.
  if (INSTANCE_SLUG.length > 0) {
    return false;
  }

  try {
    const config = await db.query.setupConfig.findFirst();
    return !config?.isComplete;
  } catch (error) {
    // Fail closed: if we cannot determine setup state, assume it is complete and
    // require a real session, so a transient DB error never opens these routes.
    log.warn("Setup-state lookup failed; requiring auth (fail-closed)", {
      error: String(error),
    });
    return false;
  }
}

/**
 * Authorization gate for the first-run setup wizard routes (`/api/setup/*`).
 *
 * These routes pre-date any user/session — the wizard must be reachable on a
 * brand-new UNSCOPED install before authentication exists. But once setup
 * completes (or in any scoped instance pod) they disclose system info (platform,
 * dependency versions, stored config paths/ports) and let a caller rewrite the
 * setup config, so they must not stay open.
 *
 * In SCOPED instance mode (a standalone pod under `RDV_BASE_PATH`) the proxy's
 * `/api` gate is only session-cookie PRESENCE (see the rationale block in
 * `src/proxy.ts`), so any garbage cookie passes the proxy and route-level auth is
 * the real boundary. This helper IS that boundary for `/api/setup/*` — and in
 * scoped mode it requires a real session unconditionally (see `isFirstRunOpen`).
 *
 * Returns `true` when EITHER:
 *  - first-run setup is still open (`isFirstRunOpen()` — unscoped + not yet
 *    complete), so the wizard works before any user/session exists; OR
 *  - the caller has a real authenticated session (`hasValidSession()`). This runs
 *    in the Node route realm, where the NextAuth / CF-identity crypto validation
 *    actually works (unlike the proxy realm in scoped mode).
 *
 * remote-dev-2rob.
 */
export async function isSetupRequestAllowed(): Promise<boolean> {
  if (await isFirstRunOpen()) {
    return true;
  }
  return hasValidSession();
}
