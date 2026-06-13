/**
 * UsageEndpointPoller - UsageLimitGateway that proactively polls the
 * (unofficial, flagged) Anthropic usage endpoint via the isolated adapter.
 *
 * Gated by `RDV_CLAUDE_USAGE_POLL_ENABLED === "1"` — DEFAULT OFF. When the flag
 * is off, `supports()` returns false and `fetchLimitState()` returns null, so
 * the poller never touches the network. When on, it loads the profile's OAuth
 * token (subscription) from its `.claude/.credentials.json`, delegates the HTTP
 * call to `anthropic-usage-adapter.fetchClaudeUsage`, and normalizes the
 * snapshot into a `LimitDetectionResult`.
 *
 * Best-effort throughout: any failure (no token, read error, adapter error)
 * logs and returns null — it must never throw.
 */

import { db } from "@/db";
import { agentProfiles } from "@/db/schema";
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
import { createLogger } from "@/lib/logger";

const log = createLogger("UsageEndpointPoller");

/** Whether proactive polling is enabled (default OFF). */
function pollEnabled(): boolean {
  return process.env.RDV_CLAUDE_USAGE_POLL_ENABLED === "1";
}

export class UsageEndpointPoller implements UsageLimitGateway {
  supports(kind: ClaudeAccountKind): boolean {
    // Only subscription accounts expose the rolling-window usage endpoint, and
    // only when the feature flag is enabled.
    return pollEnabled() && kind === "subscription";
  }

  async fetchLimitState(
    profileId: string
  ): Promise<LimitDetectionResult | null> {
    if (!pollEnabled()) return null;

    try {
      const token = await this.loadOAuthToken(profileId);
      if (!token) {
        log.debug("No OAuth token for profile; skipping poll", { profileId });
        return null;
      }

      const snapshot = await fetchClaudeUsage(token);
      if (!snapshot) return null; // stub returns null until Phase 2

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
   * Read the subscription OAuth access token from the profile's
   * `.claude/.credentials.json`. Returns null when the file is absent or
   * malformed (best-effort).
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
  // A window at/over 100% with no remaining headroom is "limited".
  const exhausted =
    (snapshot.window5hPct ?? 0) >= 100 || (snapshot.window7dPct ?? 0) >= 100;

  return {
    profileId,
    isLimited: exhausted,
    resetAt5h: snapshot.resetAt5h,
    resetAt7d: snapshot.resetAt7d,
    window5hPct: snapshot.window5hPct,
    window7dPct: snapshot.window7dPct,
    source: "poller",
  };
}
