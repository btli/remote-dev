/**
 * UsageEndpointPoller - UsageLimitGateway that proactively reads a Claude
 * account's rate-limit headroom from the (flagged) Messages API rate-limit
 * headers via the isolated adapter.
 *
 * Gated by `RDV_CLAUDE_USAGE_POLL_ENABLED === "1"` — DEFAULT OFF. When the flag
 * is off, `supports()` returns false and `fetchLimitState()` returns null, so
 * the poller never touches the network. When on, it resolves the profile's
 * account kind, loads the matching credential (subscription → OAuth token from
 * `.claude/.credentials.json`; api_key → not yet wired, see below), delegates
 * the HTTP probe to `anthropic-usage-adapter.fetchClaudeUsage`, and normalizes
 * the snapshot into a `LimitDetectionResult`.
 *
 *   subscription → 5h/7d rolling-window utilization + reset.
 *   api_key      → a single rate/credit "org" dimension (worst-case rate-limit
 *                  utilization + soonest replenish/retry-after), mapped onto the
 *                  5h slot of the LimitDetectionResult (the use-case/repo carry
 *                  5h/7d only). The adapter parses the api_key headers for real;
 *                  loading + decrypting the raw key lives in the account-login /
 *                  secrets path (a separate change), so this poller does not
 *                  reach into profile_secrets_config — when no key is available
 *                  it returns null (a safe no-op) rather than crossing that
 *                  boundary.
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
    // The adapter can read rate-limit headers for both kinds; the poller is
    // only ever active when the feature flag is enabled.
    return isUsagePollEnabled() && (kind === "subscription" || kind === "api_key");
  }

  async fetchLimitState(
    profileId: string
  ): Promise<LimitDetectionResult | null> {
    if (!isUsagePollEnabled()) return null;

    try {
      const kind = await this.resolveKind(profileId);

      const token =
        kind === "subscription"
          ? await this.loadOAuthToken(profileId)
          : null; // api_key: raw key lives in the secrets path (not wired here)
      if (!token) {
        log.debug("No credential for profile; skipping poll", { profileId, kind });
        return null;
      }

      const snapshot = await fetchClaudeUsage(token, kind);
      if (!snapshot) return null;

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
