/**
 * usage-poll-sweep - Periodic proactive usage-limit poll across Claude accounts.
 *
 * [remote-dev-3b3l] Registered as a ~10-minute sweep from `src/server/index.ts`
 * alongside the other orchestrators.
 *
 * [remote-dev-n4x4.6] The sweep iterates ACCOUNTS, not profiles, and records
 * observations keyed on `claude_account.id`.
 *
 * [remote-dev-n4x4.4] The gateway is now account-keyed too, so EVERY account is
 * polled — not just the ones that still carry an origin-profile breadcrumb. The
 * old `isNotNull(profile_id)` filter silently skipped every account added via
 * "Add account" (the normal path since n4x4.6), which is most of them.
 *
 * The sweep is a NO-OP when the poller is disabled
 * (`RDV_CLAUDE_USAGE_POLL_ENABLED=0`): the `UsageEndpointPoller` self-guards,
 * but we also short-circuit here so the disabled path doesn't enumerate
 * accounts or touch the DB at all.
 */

import { db } from "@/db";
import {
  usageLimitGateway,
  trackUsageLimitUseCase,
} from "@/infrastructure/container";
import { isUsagePollEnabled } from "./poll-config";
import { createLogger } from "@/lib/logger";

const log = createLogger("UsagePollSweep");

/**
 * Run one proactive poll sweep over all Claude accounts. Best-effort: never
 * throws; logs a per-sweep summary at debug. No-op when the flag is off.
 */
export async function runUsagePollSweep(): Promise<void> {
  if (!isUsagePollEnabled()) return;

  let polled = 0;
  let recorded = 0;
  try {
    const accounts = await db.query.claudeAccounts.findMany({
      columns: { id: true, userId: true, profileId: true },
    });

    for (const account of accounts) {
      polled += 1;
      try {
        const result = await usageLimitGateway.fetchLimitState({
          accountId: account.id,
          userId: account.userId,
          profileId: account.profileId ?? null,
        });
        if (!result) continue; // poller disabled for kind, no token, or stub
        await trackUsageLimitUseCase.execute({
          accountId: account.id,
          userId: account.userId,
          source: result.source,
          isLimited: result.isLimited,
          resetAt5h: result.resetAt5h,
          resetAt7d: result.resetAt7d,
          window5hPct: result.window5hPct,
          window7dPct: result.window7dPct,
          // Per-window detail, incl. per-model `weekly_scoped` entries the
          // 5h/7d rollup cannot represent. [remote-dev-n4x4.2]
          windows: result.windows,
          observedAt: new Date(),
        });
        recorded += 1;
      } catch (error) {
        log.warn("Per-account usage poll failed", {
          accountId: account.id,
          error: String(error),
        });
      }
    }

    log.debug("Usage poll sweep complete", { polled, recorded });
  } catch (error) {
    log.error("Usage poll sweep failed", { error: String(error) });
  }
}
