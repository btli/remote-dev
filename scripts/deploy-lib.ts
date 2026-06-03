import { existsSync, rmSync, mkdirSync, cpSync } from "fs";
import { dirname } from "path";

/** SSR page routes probed by the deploy/rollback health gate. */
export const SSR_PROBE_PATHS = ["/", "/login"] as const;

/**
 * Whether an HTTP status from an SSR probe of `path` is acceptable.
 *
 * The local health check otherwise only exercises `/api/*`, so a build whose
 * SSR/middleware path is broken (e.g. a proxy redirect that 500s page routes —
 * the 2026-06-03 incident) passes on the API probe alone. These page probes
 * close that gap:
 *   "/"      → an unauthenticated request redirects to /login, so 2xx/3xx is
 *              healthy; any 4xx/5xx means routing or the proxy redirect broke.
 *   "/login" → an always-rendering SSR page; must be exactly 200.
 */
export function isAcceptableSsrStatus(path: string, status: number): boolean {
  if (path === "/login") return status === 200;
  return status >= 200 && status < 400;
}

/**
 * Restore a slot's standalone build over the live serving directory.
 *
 * The prod server runs from `PROJECT_ROOT/.next/standalone`; a failed deploy
 * leaves the NEW (broken) build there. Rollback MUST copy the target slot's
 * known-good snapshot back BEFORE restarting, otherwise the restart re-serves
 * the broken build (remote-dev-j0x5). The slot's standalone already contains
 * `.next/static` + `public` (buildSlot populates them), so a single recursive
 * copy is complete.
 */
export function restoreStandalone(
  srcSlotStandalone: string,
  liveStandalone: string,
): { ok: boolean; reason?: string } {
  if (!existsSync(srcSlotStandalone)) {
    return { ok: false, reason: `slot standalone not found: ${srcSlotStandalone}` };
  }
  if (existsSync(liveStandalone)) {
    rmSync(liveStandalone, { recursive: true, force: true });
  }
  mkdirSync(dirname(liveStandalone), { recursive: true });
  cpSync(srcSlotStandalone, liveStandalone, { recursive: true });
  return { ok: true };
}
