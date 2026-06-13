/**
 * usage-poll-sweep - Periodic proactive usage-limit poll across Claude profiles.
 *
 * [remote-dev-3b3l] Registered as a ~10-minute sweep from `src/server/index.ts`
 * alongside the other orchestrators. The sweep is a NO-OP unless the proactive
 * poller is enabled (`RDV_CLAUDE_USAGE_POLL_ENABLED === "1"`): the underlying
 * `UsageEndpointPoller` self-guards (it `supports()` nothing and returns null
 * when the flag is off), but we also short-circuit here so the disabled path
 * doesn't even enumerate profiles or touch the DB.
 *
 * For each Claude-capable profile it asks the composite gateway for the current
 * limit state (the gateway dispatches by the profile's account kind to the
 * poller; the reactive detector has nothing to poll). A non-null result is
 * recorded via `TrackUsageLimitUseCase` (staleness-guarded so a slower poll
 * can't clobber a fresher reactive observation). Per-profile errors are caught
 * so one bad profile can't abort the sweep.
 */

import { db } from "@/db";
import { agentProfiles } from "@/db/schema";
import { inArray } from "drizzle-orm";
import {
  usageLimitGateway,
  trackUsageLimitUseCase,
} from "@/infrastructure/container";
import { createLogger } from "@/lib/logger";

const log = createLogger("UsagePollSweep");

/** Whether the proactive poller is enabled (default OFF). */
function pollEnabled(): boolean {
  return process.env.RDV_CLAUDE_USAGE_POLL_ENABLED === "1";
}

/**
 * Run one proactive poll sweep over all Claude-capable profiles. Best-effort:
 * never throws; logs a per-sweep summary at debug. No-op when the flag is off.
 */
export async function runUsagePollSweep(): Promise<void> {
  if (!pollEnabled()) return;

  let polled = 0;
  let recorded = 0;
  try {
    // Claude-capable profiles: provider "claude" or the catch-all "all".
    const profiles = await db.query.agentProfiles.findMany({
      where: inArray(agentProfiles.provider, ["claude", "all"]),
      columns: { id: true, userId: true },
    });

    for (const profile of profiles) {
      polled += 1;
      try {
        const result = await usageLimitGateway.fetchLimitState(
          profile.id,
          profile.userId
        );
        if (!result) continue; // poller disabled for kind, no token, or stub
        await trackUsageLimitUseCase.execute({
          profileId: result.profileId,
          userId: profile.userId,
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
        log.warn("Per-profile usage poll failed", {
          profileId: profile.id,
          error: String(error),
        });
      }
    }

    log.debug("Usage poll sweep complete", { polled, recorded });
  } catch (error) {
    log.error("Usage poll sweep failed", { error: String(error) });
  }
}
