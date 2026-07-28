/**
 * usage-poll-sweep - Periodic proactive usage-limit poll across Claude accounts.
 *
 * [remote-dev-3b3l] Registered as a ~10-minute sweep from `src/server/index.ts`
 * alongside the other orchestrators. The sweep is a NO-OP unless the proactive
 * poller is enabled (`RDV_CLAUDE_USAGE_POLL_ENABLED === "1"`): the underlying
 * `UsageEndpointPoller` self-guards (it `supports()` nothing and returns null
 * when the flag is off), but we also short-circuit here so the disabled path
 * doesn't even enumerate accounts or touch the DB.
 *
 * [remote-dev-n4x4.6] The sweep now iterates ACCOUNTS, not profiles, and records
 * observations keyed on `claude_account.id`.
 *
 * The `UsageLimitGateway` port is still profile-keyed: its two adapters
 * (`ReactiveOutputDetector`, `UsageEndpointPoller`) are owned by other issues
 * (n4x4.1 / n4x4.5) and are intentionally untouched here. So an account is
 * polled through its *origin profile* breadcrumb, and accounts with no origin
 * profile are skipped — which is a no-op today because the poller is disabled
 * by default AND its credential path is empty on macOS.
 * TODO(remote-dev-n4x4.4): give the gateway an `accountId` + the account's
 * decrypted `CLAUDE_CODE_OAUTH_TOKEN` so standalone accounts poll too, and drop
 * the origin-profile bridge below.
 */

import { db } from "@/db";
import { claudeAccounts } from "@/db/schema";
import { isNotNull } from "drizzle-orm";
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
    // Only accounts that still carry an origin profile can be polled through
    // the (profile-keyed) gateway — see the TODO above.
    const accounts = await db.query.claudeAccounts.findMany({
      where: isNotNull(claudeAccounts.profileId),
      columns: { id: true, userId: true, profileId: true },
    });

    for (const account of accounts) {
      // Query filters nulls; narrow for the (still-nullable) column type.
      const profileId = account.profileId;
      if (!profileId) continue;

      polled += 1;
      try {
        const result = await usageLimitGateway.fetchLimitState(
          profileId,
          account.userId
        );
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
