/**
 * CompositeUsageLimitGateway - The single UsageLimitGateway wired into the
 * container. Holds the concrete adapters and dispatches `fetchLimitState` by
 * the ACCOUNT's AccountKind to the first adapter that `supports(kind)`.
 *
 * The kind comes from the `claude_account` row itself; a missing row defaults
 * to "subscription" (the common OAuth case). The raw kind is wrapped in the
 * `AccountKind` value object so an unrecognized stored brand falls through to
 * "no gateway" rather than throwing.
 *
 * ## Dispatch is FALL-THROUGH, not first-match [review G1]
 *
 * It used to be `adapters.find(a => a.supports(kind))` — first match wins. That
 * made the whole proactive path dead code: `ReactiveOutputDetector` is
 * registered first, `supports("subscription")` returns true unconditionally,
 * and its `fetchLimitState()` ALWAYS returns null because reactive detection is
 * event-driven (observations arrive via `/internal/usage-limit`, not by
 * polling). So for every subscription account — the only kind the poller serves
 * — the composite picked the reactive stub, got null, and `UsageEndpointPoller`
 * was never invoked. No usage was ever polled. The bug was masked while the
 * poller flag defaulted off.
 *
 * Now every adapter that `supports(kind)` is tried IN ORDER until one returns a
 * non-null observation. An adapter that cannot answer on demand simply yields
 * to the next, so registration order stays a preference rather than a veto.
 *
 * api_key accounts currently resolve to "no gateway": the poller's usage
 * endpoint is subscription-only (`supports("api_key")` is false), and the
 * reactive detector keys off subscription reset headers [remote-dev-n4x4.1].
 * Each adapter's `supports()` remains authoritative.
 */

import { db } from "@/db";
import { claudeAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import type {
  UsageLimitGateway,
  LimitDetectionResult,
  UsageLimitTarget,
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
    target: UsageLimitTarget
  ): Promise<LimitDetectionResult | null> {
    const accountKind = await this.resolveKind(target.accountId);
    if (!accountKind) return null; // unrecognized stored kind → no gateway

    // Each adapter's supports() encodes both the kind AND any feature flag (the
    // poller is a no-op unless enabled), so a disabled poller drops out here
    // rather than swallowing the dispatch.
    const kind = accountKind.toString();
    const supporting = this.adapters.filter((a) => a.supports(kind));
    if (supporting.length === 0) {
      log.debug("No gateway supports account kind", {
        accountId: target.accountId,
        kind,
      });
      return null;
    }

    // Fall through until one adapter actually produces an observation. See the
    // module docblock: an always-null adapter must not veto the ones after it.
    for (const adapter of supporting) {
      const result = await adapter.fetchLimitState(target);
      if (result) return result;
    }
    return null;
  }

  /**
   * The account's kind as an `AccountKind` VO. An ABSENT row defaults to
   * subscription (the common OAuth case); a PRESENT-but-unrecognized value
   * returns null so dispatch falls through to "no gateway" (the prior
   * behavior, where `supports()` rejected the unknown brand).
   *
   * [remote-dev-n4x4.4] Resolved by `claude_account.id` directly. It used to
   * look the account up by `profile_id`, which since n4x4.6 is a nullable,
   * NON-unique origin breadcrumb — so a standalone account resolved to no row
   * at all and two accounts from one profile were indistinguishable.
   */
  private async resolveKind(accountId: string): Promise<AccountKind | null> {
    const account = await db.query.claudeAccounts.findFirst({
      where: eq(claudeAccounts.id, accountId),
      columns: { accountKind: true },
    });
    if (!account?.accountKind) return AccountKind.subscription();
    try {
      return AccountKind.create(account.accountKind);
    } catch {
      log.warn("Unknown stored account kind; no usage-limit gateway", {
        accountId,
        raw: String(account.accountKind),
      });
      return null;
    }
  }
}
