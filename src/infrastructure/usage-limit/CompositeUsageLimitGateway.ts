/**
 * CompositeUsageLimitGateway - The single UsageLimitGateway wired into the
 * container. Holds the concrete adapters and dispatches `fetchLimitState` by
 * the profile's AccountKind to the first adapter that `supports(kind)`.
 *
 * The profile's kind comes from its `claude_account` row; profiles with no
 * `claude_account` row default to "subscription" (the common case — a profile
 * logged in via OAuth).
 */

import { db } from "@/db";
import { claudeAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import type {
  UsageLimitGateway,
  LimitDetectionResult,
} from "@/application/ports/UsageLimitGateway";
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
    const kind = await this.resolveKind(profileId);
    const adapter = this.adapters.find((a) => a.supports(kind));
    if (!adapter) {
      log.debug("No gateway supports account kind", { profileId, kind });
      return null;
    }
    return adapter.fetchLimitState(profileId, userId);
  }

  /** The profile's account kind, defaulting to "subscription". */
  private async resolveKind(profileId: string): Promise<ClaudeAccountKind> {
    const account = await db.query.claudeAccounts.findFirst({
      where: eq(claudeAccounts.profileId, profileId),
      columns: { accountKind: true },
    });
    return (account?.accountKind as ClaudeAccountKind | undefined) ?? "subscription";
  }
}
