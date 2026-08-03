/**
 * UsageEndpointPoller - UsageLimitGateway that proactively reads a Claude
 * ACCOUNT's usage headroom from the structured OAuth usage endpoint via the
 * isolated adapter (`anthropic-usage-adapter.fetchClaudeUsage`).
 *
 * The read burns no quota — a GET against `/api/oauth/usage`, no message send.
 * The endpoint can still rate-limit requests; [remote-dev-u7df] a 429 surfaces
 * here as a typed `UsageLimitRateLimited` signal carrying the reset time, which
 * the sweep uses to schedule the next attempt instead of blind backoff.
 *
 * The poller is OPT-IN: it runs only with an explicit positive
 * `RDV_CLAUDE_USAGE_POLL_ENABLED` (see `poll-config.ts` for why default-off).
 * When disabled, `supports()` returns false and `fetchLimitState()` returns
 * null, so the poller never touches the network.
 *
 * ## Credential [remote-dev-n4x4.4]
 *
 * The poller uses the account's independent usage OAuth credential set: a
 * short-lived access token plus a long-lived refresh token carrying the
 * `user:profile` scope. The access token is refreshed server-side on demand.
 * It never reads or falls back to the separate setup-token used for session
 * injection.
 *
 * **Subscription accounts only.** [remote-dev-n4x4.1] The usage endpoint
 * describes claude.ai's rolling 5h/7d windows, which a raw API key does not
 * have; a key's headroom lives in the documented per-minute rate-limit headers
 * on Messages API responses, and there is no free endpoint that reports them.
 * So `supports()` covers `subscription` only, and an api_key account resolves
 * to "no gateway" in the composite rather than to a poller that returns null.
 *
 * The snapshot's per-window `limits[]` — including per-model `weekly_scoped`
 * entries — rides out on `LimitDetectionResult.windows` and is persisted by the
 * sweep. [remote-dev-n4x4.2]
 *
 * Security: the decrypted token is used ONLY as the adapter's request
 * credential. It is never logged, returned, or persisted here.
 *
 * Best-effort throughout: any failure (no token, read error, adapter error)
 * logs and returns null — it must never throw. A rate-limited read is NOT a
 * failure: it returns the typed signal instead of null.
 */

import { db } from "@/db";
import { claudeAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import type {
  UsageLimitGateway,
  LimitDetectionResult,
  UsageLimitRateLimited,
  UsageLimitTarget,
} from "@/application/ports/UsageLimitGateway";
import type { UsageLimitWindow } from "@/application/ports/UsageLimitWindowRepository";
import type { ClaudeAccountKind } from "@/types/claude-limits";
import {
  fetchClaudeUsage,
  type ClaudeUsageSnapshot,
} from "@/infrastructure/external/anthropic-usage-adapter";
import { isUsagePollEnabled } from "./poll-config";
import { createLogger } from "@/lib/logger";

const log = createLogger("UsageEndpointPoller");

/**
 * Resolve a fresh usage access token for an account. Injectable so tests never
 * touch a real credential or refresh endpoint.
 */
export type AccountTokenReader = (
  accountId: string,
  userId: string
) => Promise<string | null>;

/**
 * Default reader: the ONE ownership-scoped account→usage-credential operation.
 * Lazily imported so the container does not take a static infra→services edge.
 */
const defaultTokenReader: AccountTokenReader = async (accountId, userId) => {
  const { getFreshUsageAccessToken } = await import(
    "@/infrastructure/external/anthropic-oauth-refresh"
  );
  return getFreshUsageAccessToken(accountId, userId);
};

export class UsageEndpointPoller implements UsageLimitGateway {
  constructor(
    private readonly readAccountToken: AccountTokenReader = defaultTokenReader
  ) {}

  supports(kind: ClaudeAccountKind): boolean {
    // Subscription only — the usage endpoint has no api_key equivalent (see the
    // module docblock). The poller is also only ever active behind the flag.
    return isUsagePollEnabled() && kind === "subscription";
  }

  async fetchLimitState(
    target: UsageLimitTarget
  ): Promise<LimitDetectionResult | UsageLimitRateLimited | null> {
    if (!isUsagePollEnabled()) return null;

    const { accountId, userId } = target;
    try {
      const kind = await this.resolveKind(accountId);
      if (kind !== "subscription") {
        log.debug("Account kind has no free usage read; skipping poll", {
          accountId,
          kind,
        });
        return null;
      }

      const token = await this.readAccountToken(accountId, userId);
      if (!token) return null;

      const result = await fetchClaudeUsage(token, kind);
      if (result.outcome === "rate-limited") {
        // No observation exists, but the refusal names the reset — pass it
        // through typed so the sweep can align to it. [remote-dev-u7df]
        return { rateLimited: true, accountId, retryAt: result.retryAt };
      }
      if (result.outcome === "forbidden") return null;
      if (result.outcome !== "snapshot") return null;

      logScopedLimits(accountId, result.snapshot);
      return usageSnapshotToLimitDetectionResult(accountId, result.snapshot);
    } catch (error) {
      log.warn("Usage poll failed (best-effort)", {
        accountId,
        error: String(error),
      });
      return null;
    }
  }

  /**
   * The account's kind from its `claude_account` row. An absent row defaults to
   * subscription (the common OAuth case).
   */
  private async resolveKind(accountId: string): Promise<ClaudeAccountKind> {
    const account = await db.query.claudeAccounts.findFirst({
      where: eq(claudeAccounts.id, accountId),
      columns: { accountKind: true },
    });
    return account?.accountKind === "api_key" ? "api_key" : "subscription";
  }
}

/**
 * Surface the windows the 5h/7d rollup cannot represent — notably per-model
 * `weekly_scoped` entries, where an account can read "available" overall while
 * one model's weekly window is exhausted. Debug-level observability; the
 * authoritative copy is persisted from `LimitDetectionResult.windows`.
 */
function logScopedLimits(
  accountId: string,
  snapshot: ClaudeUsageSnapshot
): void {
  for (const limit of snapshot.limits) {
    if (limit.scopeModel === null && !limit.isActive) continue;
    log.debug("Usage window reported", {
      accountId,
      kind: limit.kind,
      group: limit.group,
      percent: limit.percent,
      severity: limit.severity,
      scopeModel: limit.scopeModel,
      isActive: limit.isActive,
    });
  }
}

/**
 * Normalize an already-validated adapter snapshot for persistence.
 *
 * Exported so the usage-credential capture flow can persist its validation
 * snapshot immediately without issuing a second Anthropic request.
 */
export function usageSnapshotToLimitDetectionResult(
  accountId: string,
  snapshot: ClaudeUsageSnapshot
): LimitDetectionResult {
  // api_key accounts have no 5h/7d windows — the adapter reports a single
  // rate/credit "org" dimension. The downstream use-case/repo carry 5h/7d
  // slots only, so fold the org reading into the 5h slot (its soonest reset is
  // the soonest the account frees up, exactly what earliestResetAt needs).
  const window5hPct = snapshot.window5hPct ?? snapshot.orgPct;
  const resetAt5h = snapshot.resetAt5h ?? snapshot.resetAtOrg;

  // A window at/over 100% with no remaining headroom is "limited". This stays
  // ACCOUNT-level: a single exhausted per-model window must not mark the whole
  // account limited — that is what the per-model windows below are for.
  const exhausted =
    (window5hPct ?? 0) >= 100 || (snapshot.window7dPct ?? 0) >= 100;

  return {
    accountId,
    isLimited: exhausted,
    resetAt5h,
    resetAt7d: snapshot.resetAt7d,
    window5hPct,
    window7dPct: snapshot.window7dPct,
    source: "poller",
    windows: snapshot.limits.map(toWindow),
  };
}

/** Adapter entry → repository-port window (open string sets preserved). */
function toWindow(limit: ClaudeUsageSnapshot["limits"][number]): UsageLimitWindow {
  return {
    kind: limit.kind,
    group: limit.group,
    percent: limit.percent,
    severity: limit.severity,
    resetsAt: limit.resetAt,
    scopeModel: limit.scopeModel,
    scopeSurface: limit.scopeSurface,
    isActive: limit.isActive,
  };
}
