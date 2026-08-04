/**
 * usage-poll-sweep - Periodic proactive usage-limit poll across Claude accounts.
 *
 * [remote-dev-3b3l] Registered as a ~10-minute sweep from `src/server/index.ts`
 * alongside the other orchestrators.
 *
 * [remote-dev-n4x4.6] The sweep iterates ACCOUNTS, not profiles, and records
 * observations keyed on `claude_account.id`.
 *
 * [remote-dev-n4x4.4] The gateway is account-keyed too, so EVERY account is
 * polled — not just the ones that still carry an origin-profile breadcrumb. The
 * old `isNotNull(profile_id)` filter silently skipped every account added via
 * "Add account" (the normal path since n4x4.6), which is most of them.
 *
 * ## Pacing [review G8]
 *
 * Removing that filter turned the sweep from "polls ~0 accounts" into "polls
 * every account", so it now paces itself two ways:
 *
 *   - **Bounded concurrency.** At most {@link MAX_CONCURRENT_POLLS} accounts are
 *     in flight, so a large account list cannot open an unbounded fan-out of
 *     requests at Anthropic, nor stall the sweep behind a fully serial queue.
 *   - **Per-account exponential backoff.** An account whose poll fails (revoked
 *     token, decrypt failure, endpoint error) is skipped for a growing interval
 *     instead of being retried every 10 minutes forever. Any success clears it.
 *   - **Retry-after alignment.** [remote-dev-u7df] Anthropic rate-limits
 *     requests to the usage endpoint. The 429's `retry-after` names the reset;
 *     the gateway surfaces it as a typed rate-limited result and the sweep
 *     schedules that account's next attempt just past the reset (plus 30-90s
 *     jitter) instead of exponential backoff. Rate limiting is upstream
 *     pacing, not a failing account, so it never escalates
 *     `consecutiveFailures`; genuine failures keep the exponential path.
 *   - **Credential gate.** Accounts without an independent usage refresh
 *     credential are skipped before gateway/network work and never accumulate
 *     failure backoff merely because usage tracking has not been enabled.
 *
 * Backoff state is deliberately in-memory: it is a pacing hint, not a fact
 * worth persisting, and a restart erring toward "try again" is the right
 * failure mode.
 *
 * The sweep is a NO-OP when the poller is not explicitly enabled: the
 * `UsageEndpointPoller` self-guards, but we also short-circuit here so the
 * disabled path doesn't enumerate accounts or touch the DB at all.
 */

import { db } from "@/db";
import {
  usageLimitGateway,
  trackUsageLimitUseCase,
} from "@/infrastructure/container";
import { isUsageLimitRateLimited } from "@/application/ports/UsageLimitGateway";
import { isUsagePollEnabled } from "./poll-config";
import { createLogger } from "@/lib/logger";
import { hasStoredUsageCredential } from "@/lib/usage-credential-presence";

const log = createLogger("UsagePollSweep");

/** Maximum accounts polled concurrently within one sweep. */
const MAX_CONCURRENT_POLLS = 4;

/** First backoff step after a failure (one sweep interval). */
const BACKOFF_BASE_MS = 10 * 60 * 1000;

/** Ceiling on the backoff interval (~6 hours). */
const BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;

/**
 * Jitter added past a reported rate-limit reset (30-90s) so the retry lands
 * safely after it and accounts don't herd onto the same instant.
 * [remote-dev-u7df]
 */
const RATE_LIMIT_JITTER_MIN_MS = 30 * 1000;
const RATE_LIMIT_JITTER_SPREAD_MS = 60 * 1000;

/** Per-account failure state driving the backoff. */
interface BackoffEntry {
  consecutiveFailures: number;
  /** Epoch ms before which this account is not polled again. */
  nextAttemptAt: number;
}

const backoff = new Map<string, BackoffEntry>();

/**
 * Clear all backoff state. Exported for tests and for callers that want the
 * next sweep to retry everything (e.g. after a credential change).
 */
export function resetUsagePollBackoff(): void {
  backoff.clear();
}

/** Whether this account is still inside its backoff interval. */
function isBackedOff(accountId: string, now: number): boolean {
  const entry = backoff.get(accountId);
  return entry !== undefined && entry.nextAttemptAt > now;
}

/** Record a failure and schedule the next attempt with exponential growth. */
function recordFailure(accountId: string, now: number): void {
  const previous = backoff.get(accountId)?.consecutiveFailures ?? 0;
  const consecutiveFailures = previous + 1;
  // 10m, 20m, 40m, 80m … capped. `consecutiveFailures - 1` keeps the first
  // retry one interval out rather than two.
  const delay = Math.min(
    BACKOFF_BASE_MS * 2 ** (consecutiveFailures - 1),
    BACKOFF_MAX_MS
  );
  backoff.set(accountId, { consecutiveFailures, nextAttemptAt: now + delay });
  log.debug("Backing off usage poll for account", {
    accountId,
    consecutiveFailures,
    retryInMs: delay,
  });
}

/**
 * A rate-limited poll is upstream pacing, not a failing account: hold the
 * account until just past the reported reset (a stale reset clamps to now)
 * and leave `consecutiveFailures` untouched so a later genuine failure starts
 * the exponential ladder from where it actually was. [remote-dev-u7df]
 */
function recordRateLimited(accountId: string, retryAt: Date, now: number): void {
  const jitter =
    RATE_LIMIT_JITTER_MIN_MS + Math.random() * RATE_LIMIT_JITTER_SPREAD_MS;
  const nextAttemptAt = Math.min(
    Math.max(retryAt.getTime(), now) + jitter,
    now + BACKOFF_MAX_MS
  );
  const consecutiveFailures = backoff.get(accountId)?.consecutiveFailures ?? 0;
  backoff.set(accountId, { consecutiveFailures, nextAttemptAt });
  log.debug("Usage poll rate-limited; aligning next attempt to the reset", {
    accountId,
    retryAt: retryAt.toISOString(),
    nextAttemptInMs: Math.round(nextAttemptAt - now),
  });
}

/** A successful poll clears any accumulated backoff. */
function recordSuccess(accountId: string): void {
  backoff.delete(accountId);
}

/**
 * Run one proactive poll sweep over all Claude accounts. Best-effort: never
 * throws; logs a visible per-sweep summary, raising it to warn when polling or
 * credential gaps need attention. No-op when the poller is disabled.
 */
export async function runUsagePollSweep(): Promise<void> {
  if (!isUsagePollEnabled()) return;

  let polled = 0;
  let recorded = 0;
  let failed = 0;
  let rateLimited = 0;
  let skipped = 0;
  let noCredential = 0;
  try {
    const accounts = await db.query.claudeAccounts.findMany({
      columns: {
        id: true,
        userId: true,
        profileId: true,
        usageOauthRefreshEncrypted: true,
      },
    });

    const now = Date.now();
    const due = accounts.filter((a) => {
      if (!hasStoredUsageCredential(a.usageOauthRefreshEncrypted)) {
        noCredential += 1;
        return false;
      }
      if (isBackedOff(a.id, now)) {
        skipped += 1;
        return false;
      }
      return true;
    });

    // Drop backoff entries for accounts that no longer exist, so a deleted
    // account can't leak an entry for the lifetime of the process.
    const liveIds = new Set(accounts.map((a) => a.id));
    for (const id of [...backoff.keys()]) {
      if (!liveIds.has(id)) backoff.delete(id);
    }

    // Bounded fan-out: N workers draining a shared cursor over `due`.
    let cursor = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= due.length) return;
        const account = due[index];

        polled += 1;
        try {
          const result = await usageLimitGateway.fetchLimitState({
            accountId: account.id,
            userId: account.userId,
            profileId: account.profileId ?? null,
          });
          if (!result) {
            // No observation available (poller disabled for this kind, no
            // fresh access token, or an upstream failure the gateway swallowed).
            // Accounts with no stored usage refresh credential were filtered
            // before this worker and never reach failure backoff.
            recordFailure(account.id, Date.now());
            failed += 1;
            continue;
          }
          if (isUsageLimitRateLimited(result)) {
            // The endpoint 429'd with a usable retry-after: align the next
            // attempt to the reported reset instead of the failure ladder.
            recordRateLimited(account.id, result.retryAt, Date.now());
            rateLimited += 1;
            continue;
          }
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
          recordSuccess(account.id);
          recorded += 1;
        } catch (error) {
          recordFailure(account.id, Date.now());
          failed += 1;
          log.warn("Per-account usage poll failed", {
            accountId: account.id,
            error: String(error),
          });
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT_POLLS, due.length) }, () =>
        worker()
      )
    );

    const summary = {
      polled,
      recorded,
      failed,
      rateLimited,
      skipped,
      noCredential,
    };
    if (failed > 0 || noCredential > 0) {
      log.warn("Usage poll sweep complete", summary);
    } else {
      log.info("Usage poll sweep complete", summary);
    }
  } catch (error) {
    log.error("Usage poll sweep failed", { error: String(error) });
  }
}
