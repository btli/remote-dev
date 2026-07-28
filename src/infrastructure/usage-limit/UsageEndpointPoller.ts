/**
 * UsageEndpointPoller - UsageLimitGateway that proactively reads a Claude
 * account's usage headroom from the structured OAuth usage endpoint via the
 * isolated adapter (`anthropic-usage-adapter.fetchClaudeUsage`).
 *
 * Gated by `RDV_CLAUDE_USAGE_POLL_ENABLED === "1"` — DEFAULT OFF. When the flag
 * is off, `supports()` returns false and `fetchLimitState()` returns null, so
 * the poller never touches the network. When on, it loads the profile's OAuth
 * access token from `.claude/.credentials.json`, asks the adapter for a
 * snapshot, and normalizes it into a `LimitDetectionResult`. The read is FREE —
 * a GET against `/api/oauth/usage`, no message send, no quota burn.
 *
 * **Subscription accounts only.** [remote-dev-n4x4.1] The usage endpoint
 * describes claude.ai's rolling 5h/7d windows, which a raw API key does not
 * have; a key's headroom lives in the documented per-minute rate-limit headers
 * on Messages API responses, and there is no free endpoint that reports them
 * (nor does this poller have access to the raw key — that lives behind the
 * account-login / secrets path). So `supports()` covers `subscription` only,
 * and an api_key profile resolves to "no gateway" in the composite rather than
 * to a poller that would always return null.
 *
 * The snapshot's per-window `limits[]` — including per-model `weekly_scoped`
 * entries — is richer than the 5h/7d `LimitDetectionResult` the use-case and
 * repository carry. It is logged for observability here; persisting it (and
 * making profile selection model-aware) is tracked separately.
 *
 * Best-effort throughout: any failure (no token, read error, adapter error)
 * logs and returns null — it must never throw.
 */

import { db } from "@/db";
import { agentProfiles, claudeAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { runtimeJoin as join } from "@/lib/dynamic-fs";
import type {
  UsageLimitGateway,
  LimitDetectionResult,
} from "@/application/ports/UsageLimitGateway";
import type { ClaudeAccountKind } from "@/types/claude-limits";
import {
  fetchClaudeUsage,
  type ClaudeUsageSnapshot,
} from "@/infrastructure/external/anthropic-usage-adapter";
import { isUsagePollEnabled } from "./poll-config";
import { createLogger } from "@/lib/logger";

const log = createLogger("UsageEndpointPoller");

export class UsageEndpointPoller implements UsageLimitGateway {
  supports(kind: ClaudeAccountKind): boolean {
    // Subscription only — the usage endpoint has no api_key equivalent (see the
    // module docblock). The poller is also only ever active behind the flag.
    return isUsagePollEnabled() && kind === "subscription";
  }

  async fetchLimitState(
    profileId: string
  ): Promise<LimitDetectionResult | null> {
    if (!isUsagePollEnabled()) return null;

    try {
      const kind = await this.resolveKind(profileId);
      if (kind !== "subscription") {
        log.debug("Account kind has no free usage read; skipping poll", {
          profileId,
          kind,
        });
        return null;
      }

      const token = await this.loadOAuthToken(profileId);
      if (!token) {
        log.debug("No credential for profile; skipping poll", { profileId, kind });
        return null;
      }

      const snapshot = await fetchClaudeUsage(token, kind);
      if (!snapshot) return null;

      logScopedLimits(profileId, snapshot);
      return snapshotToResult(profileId, snapshot);
    } catch (error) {
      log.warn("Usage poll failed (best-effort)", {
        profileId,
        error: String(error),
      });
      return null;
    }
  }

  /**
   * The profile's account kind from its `claude_account` row. An absent row
   * defaults to subscription (the common OAuth case).
   */
  private async resolveKind(profileId: string): Promise<ClaudeAccountKind> {
    const account = await db.query.claudeAccounts.findFirst({
      where: eq(claudeAccounts.profileId, profileId),
      columns: { accountKind: true },
    });
    return account?.accountKind === "api_key" ? "api_key" : "subscription";
  }

  /**
   * Read the subscription OAuth access token from the profile's
   * `.claude/.credentials.json`. Returns null when the file is absent or
   * malformed (best-effort). The token is handed straight to the adapter and is
   * never logged or persisted.
   */
  private async loadOAuthToken(profileId: string): Promise<string | null> {
    const profile = await db.query.agentProfiles.findFirst({
      where: eq(agentProfiles.id, profileId),
      columns: { configDir: true },
    });
    if (!profile?.configDir) return null;

    const credsPath = join(profile.configDir, ".claude", ".credentials.json");
    let raw: string;
    try {
      raw = await readFile(credsPath, "utf-8");
    } catch {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as {
        claudeAiOauth?: { accessToken?: string };
        accessToken?: string;
      };
      return parsed.claudeAiOauth?.accessToken ?? parsed.accessToken ?? null;
    } catch {
      return null;
    }
  }
}

/**
 * Surface the windows the 5h/7d `LimitDetectionResult` cannot represent —
 * notably per-model `weekly_scoped` entries, where an account can read
 * "available" overall while one model's weekly window is exhausted. Debug-level
 * only: nothing downstream consumes these yet.
 */
function logScopedLimits(profileId: string, snapshot: ClaudeUsageSnapshot): void {
  for (const limit of snapshot.limits) {
    if (limit.scopeModel === null && !limit.isActive) continue;
    log.debug("Usage window reported", {
      profileId,
      kind: limit.kind,
      group: limit.group,
      percent: limit.percent,
      severity: limit.severity,
      scopeModel: limit.scopeModel,
      isActive: limit.isActive,
    });
  }
}

/** Normalize an adapter snapshot into a poller LimitDetectionResult. */
function snapshotToResult(
  profileId: string,
  snapshot: ClaudeUsageSnapshot
): LimitDetectionResult {
  // api_key accounts have no 5h/7d windows — the adapter reports a single
  // rate/credit "org" dimension. The downstream use-case/repo carry 5h/7d
  // slots only, so fold the org reading into the 5h slot (its soonest reset is
  // the soonest the account frees up, exactly what earliestResetAt needs).
  const window5hPct = snapshot.window5hPct ?? snapshot.orgPct;
  const resetAt5h = snapshot.resetAt5h ?? snapshot.resetAtOrg;

  // A window at/over 100% with no remaining headroom is "limited".
  const exhausted =
    (window5hPct ?? 0) >= 100 || (snapshot.window7dPct ?? 0) >= 100;

  return {
    profileId,
    isLimited: exhausted,
    resetAt5h,
    resetAt7d: snapshot.resetAt7d,
    window5hPct,
    window7dPct: snapshot.window7dPct,
    source: "poller",
  };
}
