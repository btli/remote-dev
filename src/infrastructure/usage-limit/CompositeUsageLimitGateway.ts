/**
 * CompositeUsageLimitGateway - The single UsageLimitGateway wired into the
 * container. Holds the concrete adapters and dispatches `fetchLimitState` by
 * the profile's AccountKind to the first adapter that `supports(kind)`.
 *
 * The profile's kind comes from its `claude_account` row; profiles with no
 * `claude_account` row default to "subscription" (the common case — a profile
 * logged in via OAuth). The raw kind is wrapped in the `AccountKind` value
 * object so an unrecognized stored brand falls through to "no gateway" rather
 * than throwing. Dispatch is purely "first adapter that `supports(kind)`":
 * subscription accounts (rolling 5h/7d windows) are served by the reactive
 * detector and the proactive poller; api_key accounts (rate/credits) are served
 * by the poller only (when its flag is on, via the documented rate-limit
 * headers). Each adapter's `supports()` is authoritative.
 */

import { db } from "@/db";
import { claudeAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import type {
  UsageLimitGateway,
  LimitDetectionResult,
} from "@/application/ports/UsageLimitGateway";
import { AccountKind } from "@/domain/value-objects/AccountKind";
import type { ClaudeAccountKind } from "@/types/claude-limits";
import { createLogger } from "@/lib/logger";

const log = createLogger("CompositeUsageGateway");

export class CompositeUsageLimitGateway implements UsageLimitGateway {
  private readonly adapters: readonly UsageLimitGateway[];

  constructor(adapters: UsageLimitGateway[]) {
    this.adapters = adapters;
  }

  /** Supported when ANY held adapter supports the kind. */
  supports(kind: ClaudeAccountKind): boolean {
    return this.adapters.some((a) => a.supports(kind));
  }

  async fetchLimitState(
    profileId: string,
    userId: string
  ): Promise<LimitDetectionResult | null> {
    const accountKind = await this.resolveKind(profileId);
    if (!accountKind) return null; // unrecognized stored kind → no gateway

    // Dispatch to the first adapter that supports this kind. Each adapter's
    // supports() encodes both the kind AND any feature flag (the poller is a
    // no-op unless RDV_CLAUDE_USAGE_POLL_ENABLED=1), so api_key resolves to the
    // poller only when enabled and to "no gateway" otherwise.
    const kind = accountKind.toString();
    const adapter = this.adapters.find((a) => a.supports(kind));
    if (!adapter) {
      log.debug("No gateway supports account kind", { profileId, kind });
      return null;
    }
    return adapter.fetchLimitState(profileId, userId);
  }

  /**
   * The profile's account kind as an `AccountKind` VO. An ABSENT row defaults
   * to subscription (the common OAuth case); a PRESENT-but-unrecognized value
   * returns null so dispatch falls through to "no gateway" (the prior
   * behavior, where `supports()` rejected the unknown brand).
   */
  private async resolveKind(profileId: string): Promise<AccountKind | null> {
    const account = await db.query.claudeAccounts.findFirst({
      where: eq(claudeAccounts.profileId, profileId),
      columns: { accountKind: true },
    });
    if (!account?.accountKind) return AccountKind.subscription();
    try {
      return AccountKind.create(account.accountKind);
    } catch {
      log.warn("Unknown stored account kind; no usage-limit gateway", {
        profileId,
        raw: String(account.accountKind),
      });
      return null;
    }
  }
}
