/**
 * AccountKind - Value object for a Claude profile's authentication kind.
 *
 * A Claude profile maps ~1:1 onto a Claude account. That account is reached
 * either through an OAuth subscription login or a raw API key. The two differ
 * in how usage limits behave:
 *   - subscription → rolling 5h + 7d windows (the cswap-style model).
 *   - api_key      → rate limits / credit balance (no fixed rolling windows).
 *
 * Pure and immutable: no DB / fs / network. Mirrors the ProfileIsolation VO
 * style (private ctor, static factory, `equals()`).
 */

import { InvalidValueError } from "../errors/DomainError";
import type { ClaudeAccountKind } from "@/types/claude-limits";

/**
 * Coarse description of how a kind's usage limits behave. Drives which usage
 * windows the detectors/poller populate.
 */
export type WindowSemantics = "rolling_5h_7d" | "rate_credits";

const VALID_KINDS: readonly ClaudeAccountKind[] = ["subscription", "api_key"] as const;

export class AccountKind {
  private readonly value: ClaudeAccountKind;

  private constructor(value: ClaudeAccountKind) {
    this.value = value;
  }

  /**
   * Create an AccountKind from a raw value.
   * @throws InvalidValueError if the value is not a known kind.
   */
  static create(value: string): AccountKind {
    if (!VALID_KINDS.includes(value as ClaudeAccountKind)) {
      throw new InvalidValueError(
        "AccountKind",
        value,
        `Must be one of: ${VALID_KINDS.join(", ")}`
      );
    }
    return new AccountKind(value as ClaudeAccountKind);
  }

  /** Convenience factory for the OAuth subscription kind. */
  static subscription(): AccountKind {
    return new AccountKind("subscription");
  }

  /** Convenience factory for the API-key kind. */
  static apiKey(): AccountKind {
    return new AccountKind("api_key");
  }

  /** The underlying brand value. */
  toString(): ClaudeAccountKind {
    return this.value;
  }

  isSubscription(): boolean {
    return this.value === "subscription";
  }

  isApiKey(): boolean {
    return this.value === "api_key";
  }

  /**
   * How this kind's usage limits behave. Subscription accounts expose rolling
   * 5h/7d windows; api_key accounts are governed by rate limits + credits.
   */
  windowSemantics(): WindowSemantics {
    return this.value === "subscription" ? "rolling_5h_7d" : "rate_credits";
  }

  equals(other: AccountKind): boolean {
    return this.value === other.value;
  }
}
