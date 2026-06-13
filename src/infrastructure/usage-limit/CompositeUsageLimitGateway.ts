/**
 * CompositeUsageLimitGateway - The single UsageLimitGateway wired into the
 * container. Holds the concrete adapters and dispatches `fetchLimitState` by
 * the profile's AccountKind to the first adapter that `supports(kind)`.
 *
 * The profile's kind comes from its `claude_account` row; profiles with no
 * `claude_account` row default to "subscription" (the common case — a profile
 * logged in via OAuth). The raw kind is wrapped in the `AccountKind` value
 * object so dispatch reasons about window SEMANTICS rather than the bare brand:
 * only subscription accounts (rolling 5h/7d windows) have a usage-limit gateway
 * today; api_key accounts (rate/credits) have none, so the dispatch
 * short-circuits for them.
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

    // Only accounts with rolling 5h/7d windows (subscription) have a
    // usage-limit gateway; rate/credits accounts (api_key) have none, so skip
    // the adapter search entirely for them.
    if (accountKind.windowSemantics() !== "rolling_5h_7d") {
      log.debug("Account kind has no rolling-window gateway", {
        profileId,
        kind: accountKind.toString(),
        semantics: accountKind.windowSemantics(),
      });
      return null;
    }

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
