/**
 * ReactiveOutputDetector - UsageLimitGateway that detects limits by parsing
 * agent output / scrollback (the "reactive" detection source).
 *
 * The detection itself is a pure static `parse()` so it can be unit-tested and
 * reused by the rdv hook / terminal-server handler. The gateway form exists so
 * the CompositeUsageLimitGateway can treat it uniformly, but reactive
 * detection has no profile to query on demand (it is event-driven), so
 * `fetchLimitState` returns null — reactive observations flow in through the
 * `/internal/usage-limit` handler (Wave C), not by polling here.
 *
 * Only subscription accounts surface the cswap-style "usage limit reached"
 * string, so it `supports("subscription")` only.
 */

import type {
  UsageLimitGateway,
  LimitDetectionResult,
} from "@/application/ports/UsageLimitGateway";
import type { ClaudeAccountKind } from "@/types/claude-limits";

/**
 * Result of parsing a chunk of agent output for a usage-limit signal.
 * The 5h and 7d resets are reported independently — a chunk may disclose one,
 * both, or neither (each null when its epoch header is absent).
 */
export interface ReactiveParseResult {
  isLimited: boolean;
  /** The 5h reset epoch, when the output disclosed one; null otherwise. */
  resetAt5h: Date | null;
  /** The 7d reset epoch, when the output disclosed one; null otherwise. */
  resetAt7d: Date | null;
}

/**
 * The Claude-anchored phrase Claude Code prints when a subscription account
 * taps out. Because it names Claude itself, matching it is a strong signal — no
 * extra context check is needed.
 */
const CLAUDE_LIMIT_PHRASE = /claude\s+(?:ai\s+)?usage\s+limit\s+reached/i;

/**
 * Generic limit phrases that other tools also emit (npm, GitHub quota text,
 * etc.). On their own these are too weak — we only treat them as a Claude limit
 * when the surrounding text ALSO mentions "claude" (see {@link parse}).
 */
const GENERIC_LIMIT_PHRASE =
  /usage\s+limit\s+reached|you'?ve\s+(?:hit|reached)\s+your\s+usage\s+limit/i;

/** Whether the text mentions Claude at all (the disambiguating context). */
const MENTIONS_CLAUDE = /claude/i;

/**
 * The two unified rate-limit reset headers, each carrying a unix epoch
 * (seconds), e.g.
 *   anthropic-ratelimit-unified-5h-reset: 1749826800
 *   anthropic-ratelimit-unified-7d-reset: 1750000000
 * Parsed independently so a chunk can disclose either window's reset.
 */
const HEADER_RESET_5H = /anthropic-ratelimit-unified-5h-reset:\s*(\d{9,})/i;
const HEADER_RESET_7D = /anthropic-ratelimit-unified-7d-reset:\s*(\d{9,})/i;

export class ReactiveOutputDetector implements UsageLimitGateway {
  supports(kind: ClaudeAccountKind): boolean {
    return kind === "subscription";
  }

  /** Reactive detection is event-driven; nothing to poll on demand. */
  async fetchLimitState(): Promise<LimitDetectionResult | null> {
    return null;
  }

  /**
   * Parse a block of agent output for a usage-limit signal.
   *
   * Liberal but specific. The limit is flagged only when:
   *   - the Claude-anchored phrase appears (strong, self-disambiguating), OR
   *   - a generic "usage limit reached" phrase appears AND the text mentions
   *     "claude" (so unrelated tool output like "npm usage limit reached" or a
   *     GitHub quota message never trips it).
   *
   * Reset times are extracted ONLY from the authoritative epoch headers (UTC).
   * A bare human clock disclosure ("resets at 3pm") is deliberately ignored —
   * resolving it against the server's local timezone produced wrong guesses, so
   * we prefer leaving the reset null (the profile stays limited until the next
   * idle scan re-evaluates or a manual clear). The 5h and 7d resets are
   * reported separately. Both are always optional.
   *
   * @param output Raw output / scrollback text.
   */
  static parse(output: string): ReactiveParseResult {
    if (typeof output !== "string" || output.length === 0) {
      return { isLimited: false, resetAt5h: null, resetAt7d: null };
    }

    const isLimited =
      CLAUDE_LIMIT_PHRASE.test(output) ||
      (GENERIC_LIMIT_PHRASE.test(output) && MENTIONS_CLAUDE.test(output));

    if (!isLimited) {
      return { isLimited: false, resetAt5h: null, resetAt7d: null };
    }

    // Epoch headers are authoritative; report a reset only for a limited signal
    // to avoid surfacing resets from unrelated log noise.
    return {
      isLimited: true,
      resetAt5h: parseEpochHeader(output, HEADER_RESET_5H),
      resetAt7d: parseEpochHeader(output, HEADER_RESET_7D),
    };
  }
}

/** Extract a unix-epoch (seconds) reset from a single header pattern. */
function parseEpochHeader(output: string, pattern: RegExp): Date | null {
  const match = output.match(pattern);
  if (!match) return null;
  const epochSec = Number.parseInt(match[1], 10);
  if (!Number.isFinite(epochSec) || epochSec <= 0) return null;
  return new Date(epochSec * 1000);
}
