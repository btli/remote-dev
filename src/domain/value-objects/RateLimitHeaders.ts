/**
 * RateLimitHeaders - Value object for an api_key Claude account's rate/credit
 * limit, parsed from Anthropic response headers. [remote-dev-1kt5]
 *
 * Subscription accounts have rolling 5h/7d windows that reset at a fixed time.
 * API-KEY accounts do NOT — their availability is governed by request/token
 * rate limits and credit balance, surfaced via response headers:
 *
 *   anthropic-ratelimit-requests-remaining / -limit / -reset (RFC3339 or epoch)
 *   anthropic-ratelimit-tokens-remaining   / -limit / -reset
 *   anthropic-ratelimit-input-tokens-*    / anthropic-ratelimit-output-tokens-*
 *   retry-after (seconds; present on a 429)
 *
 * This VO normalizes those headers and projects them into a domain
 * {@link LimitState}: an api_key account is LIMITED when a tracked window is
 * exhausted (remaining ≤ 0) or a `retry-after` is present; it becomes available
 * again at the SOONEST applicable reset (the rate window passing), NOT at a
 * fixed 5h/7d reset. The reset rides on an `org` {@link UsageWindow} so the
 * existing `LimitState.isAvailableNow` / `RotationPolicy` logic treats it
 * uniformly — selection frees the account once the rate window passes.
 *
 * Pure and immutable: no DB / fs / network. Mirrors the other value objects.
 */

import { LimitState } from "./LimitState";
import { UsageWindow } from "./UsageWindow";
import type { UsageDetectionSource } from "@/types/claude-limits";

/** A case-insensitive header bag (header name → value). */
export type HeaderBag =
  | Headers
  | Record<string, string | string[] | undefined>
  | Map<string, string>;

/** One normalized rate-limit dimension (requests or tokens). */
interface RateDimension {
  remaining: number | null;
  limit: number | null;
  resetAt: Date | null;
}

export interface RateLimitHeadersProps {
  requests: RateDimension;
  tokens: RateDimension;
  /** `retry-after` resolved to an absolute time, or null when absent. */
  retryAfterAt: Date | null;
}

export class RateLimitHeaders {
  private readonly requests: RateDimension;
  private readonly tokens: RateDimension;
  private readonly retryAfterAt: Date | null;

  private constructor(props: RateLimitHeadersProps) {
    this.requests = props.requests;
    this.tokens = props.tokens;
    this.retryAfterAt = props.retryAfterAt
      ? new Date(props.retryAfterAt.getTime())
      : null;
  }

  /**
   * Parse a header bag into a RateLimitHeaders. `now` anchors a relative
   * `retry-after` (seconds) to an absolute time. Unknown/absent headers yield
   * null dimensions (no information), never throw.
   */
  static parse(headers: HeaderBag, now: Date): RateLimitHeaders {
    const get = makeGetter(headers);

    const requests: RateDimension = {
      remaining: parseIntOrNull(get("anthropic-ratelimit-requests-remaining")),
      limit: parseIntOrNull(get("anthropic-ratelimit-requests-limit")),
      resetAt: parseResetOrNull(get("anthropic-ratelimit-requests-reset")),
    };

    // Tokens may be split into input/output; fold to the most-constrained
    // (lowest remaining, soonest reset) so a single dimension drives the gate.
    const tokens = foldTokenDimensions(get);

    const retryAfterAt = parseRetryAfter(
      get("retry-after") ?? get("x-should-retry-after"),
      now
    );

    return new RateLimitHeaders({ requests, tokens, retryAfterAt });
  }

  /** Whether a `retry-after` was present (a hard 429 backoff). */
  hasRetryAfter(): boolean {
    return this.retryAfterAt !== null;
  }

  /** A dimension is exhausted when its remaining is known and ≤ 0. */
  private static isExhausted(dim: RateDimension): boolean {
    return dim.remaining !== null && dim.remaining <= 0;
  }

  /**
   * Whether the account is currently rate-limited: a `retry-after` is present,
   * OR a tracked window (requests / tokens) is exhausted.
   */
  isLimited(): boolean {
    return (
      this.retryAfterAt !== null ||
      RateLimitHeaders.isExhausted(this.requests) ||
      RateLimitHeaders.isExhausted(this.tokens)
    );
  }

  /**
   * When the account is next available: the SOONEST reset among the constraints
   * that are actually active (retry-after, plus the reset of any exhausted
   * window). Null when limited with no disclosed reset (stays limited until a
   * later observation clears it — same convention as a windowed limit).
   */
  availableAt(): Date | null {
    const candidates: number[] = [];
    if (this.retryAfterAt) candidates.push(this.retryAfterAt.getTime());
    if (RateLimitHeaders.isExhausted(this.requests) && this.requests.resetAt) {
      candidates.push(this.requests.resetAt.getTime());
    }
    if (RateLimitHeaders.isExhausted(this.tokens) && this.tokens.resetAt) {
      candidates.push(this.tokens.resetAt.getTime());
    }
    if (candidates.length === 0) return null;
    return new Date(Math.min(...candidates));
  }

  /**
   * Utilization of the MOST-constrained tracked dimension, 0-100, or null when
   * neither dimension discloses both limit and remaining. Used purely for the
   * dashboard's bar (the `org` window).
   */
  utilizationPct(): number | null {
    const pcts: number[] = [];
    for (const dim of [this.requests, this.tokens]) {
      if (
        dim.limit !== null &&
        dim.limit > 0 &&
        dim.remaining !== null &&
        Number.isFinite(dim.remaining)
      ) {
        const used = ((dim.limit - dim.remaining) / dim.limit) * 100;
        pcts.push(clampPct(used));
      }
    }
    if (pcts.length === 0) return null;
    return Math.max(...pcts);
  }

  /**
   * Project into a domain {@link LimitState} for the given profile. The reset
   * (when known) rides on an `org` {@link UsageWindow} so `isAvailableNow` /
   * rotation free the account once the rate window passes — NOT at a fixed
   * 5h/7d reset. A limited-without-reset observation produces a limited state
   * with no window (stays limited until cleared), mirroring the windowed path.
   */
  toLimitState(
    profileId: string,
    opts?: { source?: UsageDetectionSource; observedAt?: Date }
  ): LimitState {
    const source = opts?.source ?? "poller";
    const observedAt = opts?.observedAt ?? null;
    const limited = this.isLimited();

    const pct = this.utilizationPct();
    const resetAt = this.availableAt();

    // Build an `org` window only when there's something to record (a pct or a
    // reset). When limited with neither pct nor reset, omit the window — the
    // limited flag with no reset keeps it unavailable until cleared.
    const windows: UsageWindow[] = [];
    const hasPct = pct !== null;
    const hasReset = resetAt !== null;
    if (hasPct || hasReset) {
      windows.push(
        UsageWindow.create("org", hasPct ? (pct as number) : limited ? 100 : 0, resetAt)
      );
    }

    return limited
      ? LimitState.limited(profileId, { windows, source, lastCheckedAt: observedAt })
      : LimitState.available(profileId, { windows, source, lastCheckedAt: observedAt });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Header parsing helpers (pure)
// ─────────────────────────────────────────────────────────────────────────────

/** Build a case-insensitive single-value getter over any supported bag. */
function makeGetter(headers: HeaderBag): (name: string) => string | null {
  if (headers instanceof Headers) {
    return (name) => headers.get(name);
  }
  if (headers instanceof Map) {
    const lower = new Map<string, string>();
    for (const [k, v] of headers) lower.set(k.toLowerCase(), v);
    return (name) => lower.get(name.toLowerCase()) ?? null;
  }
  const lower = new Map<string, string>();
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    lower.set(k.toLowerCase(), Array.isArray(v) ? (v[0] ?? "") : v);
  }
  return (name) => lower.get(name.toLowerCase()) ?? null;
}

/** Fold input/output/total token dimensions into the most-constrained one. */
function foldTokenDimensions(
  get: (name: string) => string | null
): RateDimension {
  const dims: RateDimension[] = [
    {
      remaining: parseIntOrNull(get("anthropic-ratelimit-tokens-remaining")),
      limit: parseIntOrNull(get("anthropic-ratelimit-tokens-limit")),
      resetAt: parseResetOrNull(get("anthropic-ratelimit-tokens-reset")),
    },
    {
      remaining: parseIntOrNull(
        get("anthropic-ratelimit-input-tokens-remaining")
      ),
      limit: parseIntOrNull(get("anthropic-ratelimit-input-tokens-limit")),
      resetAt: parseResetOrNull(get("anthropic-ratelimit-input-tokens-reset")),
    },
    {
      remaining: parseIntOrNull(
        get("anthropic-ratelimit-output-tokens-remaining")
      ),
      limit: parseIntOrNull(get("anthropic-ratelimit-output-tokens-limit")),
      resetAt: parseResetOrNull(get("anthropic-ratelimit-output-tokens-reset")),
    },
  ];

  // Most-constrained = lowest known remaining; soonest known reset.
  let remaining: number | null = null;
  let limit: number | null = null;
  let resetAt: Date | null = null;
  for (const d of dims) {
    if (d.remaining !== null && (remaining === null || d.remaining < remaining)) {
      remaining = d.remaining;
      limit = d.limit;
    }
    if (d.resetAt && (resetAt === null || d.resetAt.getTime() < resetAt.getTime())) {
      resetAt = d.resetAt;
    }
  }
  return { remaining, limit, resetAt };
}

function parseIntOrNull(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a reset header. Anthropic emits RFC3339 (`2026-06-13T12:00:00Z`); some
 * surfaces emit a unix epoch (seconds). Accept either; null when unparseable.
 */
function parseResetOrNull(raw: string | null): Date | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Pure-digit → unix epoch SECONDS (10 digits) or MILLISECONDS (13 digits).
  if (/^\d+$/.test(trimmed)) {
    const n = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    const ms = trimmed.length >= 13 ? n : n * 1000;
    return new Date(ms);
  }
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/**
 * Resolve `retry-after` to an absolute time. Anthropic sends seconds (a
 * delta); also tolerate an HTTP-date. Anchored to `now` for the delta form.
 */
function parseRetryAfter(raw: string | null, now: Date): Date | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return new Date(now.getTime() + seconds * 1000);
  }
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function clampPct(value: number): number {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}
