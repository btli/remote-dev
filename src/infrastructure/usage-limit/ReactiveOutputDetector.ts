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

/** Result of parsing a chunk of agent output for a usage-limit signal. */
export interface ReactiveParseResult {
  isLimited: boolean;
  /** The reset time when the output disclosed one; null otherwise. */
  resetAt: Date | null;
}

/**
 * The specific phrase Claude Code prints when a subscription account taps out.
 * We require this phrase (not just the word "limit") to avoid false positives
 * on unrelated text like "rate limit your requests" or "character limit".
 */
const LIMIT_PHRASE =
  /claude\s+(?:ai\s+)?usage\s+limit\s+reached|usage\s+limit\s+reached|you'?ve\s+(?:hit|reached)\s+your\s+usage\s+limit/i;

/**
 * Header line some responses carry:
 *   anthropic-ratelimit-unified-5h-reset: 1749826800
 * The value is a unix epoch (seconds). We accept the 5h or 7d unified header.
 */
const HEADER_RESET =
  /anthropic-ratelimit-unified-(?:5h|7d)-reset:\s*(\d{9,})/i;

/**
 * Human "resets at <time>" disclosure, e.g.
 *   "Your limit will reset at 3pm."
 *   "resets at 11:30pm (America/Los_Angeles)"
 *   "resets at 15:00"
 * Captures the clock time; we resolve it to the next occurrence from `now`.
 */
const RESET_AT_CLOCK =
  /resets?\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;

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
   * Liberal but specific: the limit is only flagged when the recognizable
   * phrase appears. A reset time is extracted when present (epoch header
   * preferred, then a "resets at <clock>" disclosure) but is always optional.
   *
   * @param output Raw output / scrollback text.
   * @param now Reference time for resolving a bare clock time (defaults to now).
   */
  static parse(output: string, now: Date = new Date()): ReactiveParseResult {
    if (typeof output !== "string" || output.length === 0) {
      return { isLimited: false, resetAt: null };
    }

    const isLimited = LIMIT_PHRASE.test(output);

    // A reset epoch header is authoritative when present (even alongside the
    // phrase). We still only report a reset for a limited signal to avoid
    // surfacing resets from unrelated log noise.
    const resetAt = parseReset(output, now);

    if (!isLimited) {
      return { isLimited: false, resetAt: null };
    }
    return { isLimited: true, resetAt };
  }
}

/** Extract a reset time: epoch header first, then a "resets at <clock>". */
function parseReset(output: string, now: Date): Date | null {
  const header = output.match(HEADER_RESET);
  if (header) {
    const epochSec = Number.parseInt(header[1], 10);
    if (Number.isFinite(epochSec) && epochSec > 0) {
      return new Date(epochSec * 1000);
    }
  }

  const clock = output.match(RESET_AT_CLOCK);
  if (clock) {
    return resolveClockTime(clock, now);
  }

  return null;
}

/**
 * Resolve a captured clock time ("3", "3pm", "15:00", "11:30pm") to the next
 * occurrence at/after `now`. Bare 24h times are taken literally; am/pm applies
 * 12-hour conversion. If the resolved time is already in the past today, roll
 * to tomorrow.
 */
function resolveClockTime(
  match: RegExpMatchArray,
  now: Date
): Date | null {
  let hour = Number.parseInt(match[1], 10);
  const minute = match[2] ? Number.parseInt(match[2], 10) : 0;
  const meridiem = match[3]?.toLowerCase();

  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;

  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  const candidate = new Date(now.getTime());
  candidate.setHours(hour, minute, 0, 0);
  // Already past → next day.
  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate;
}
