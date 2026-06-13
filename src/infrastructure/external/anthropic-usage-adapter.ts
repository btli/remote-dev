/**
 * anthropic-usage-adapter - The ONE volatile seam for proactive usage polling.
 *
 * cswap reads a Claude account's usage headroom without waiting to hit a limit.
 * The reliable, normalized signal is the **rate-limit response headers on the
 * Messages API** — every `POST /v1/messages` response (200 *and* 429) carries
 * them. We send the cheapest possible probe (`max_tokens: 1`) and read the
 * headers off the response; we never need the response *body*, so even a 429
 * (over a rate limit) is a useful, non-failing read. ALL knowledge of the wire
 * format lives here behind a single function; everything upstream (the poller,
 * the gateway, the use-cases) depends only on the normalized
 * `ClaudeUsageSnapshot`.
 *
 * Two header families, dispatched by AccountKind (see {@link fetchClaudeUsage}):
 *
 *   subscription (OAuth, claude.ai 5h/7d rolling windows)
 *     anthropic-ratelimit-unified-5h-{remaining,limit,reset}
 *     anthropic-ratelimit-unified-7d-{remaining,limit,reset}
 *   These "unified" headers expose the consumer-subscription rolling-window
 *   utilization. They are **NOT** part of the documented public rate-limit API
 *   (https://platform.claude.com/docs/en/api/rate-limits lists only the
 *   classic per-minute headers below); they ride the same Messages responses
 *   that the Claude Code CLI sees, and the ReactiveOutputDetector already keys
 *   off `unified-5h/7d-reset`. We treat them as best-effort: absent → null, so
 *   the poller is a safe no-op on accounts that don't surface them.
 *
 *   api_key (raw key, rate limits + credits — NO fixed rolling reset)
 *     anthropic-ratelimit-requests-{limit,remaining,reset}   (RFC 3339 reset)
 *     anthropic-ratelimit-input-tokens-{limit,remaining,reset}
 *     anthropic-ratelimit-output-tokens-{limit,remaining,reset}
 *     anthropic-ratelimit-tokens-{limit,remaining,reset}
 *     retry-after  (seconds, on 429)
 *   These ARE documented. There is no 5h/7d window for a raw key — the account
 *   is governed by per-minute rate limits and credit balance — so we surface a
 *   single "org" dimension (worst-case utilization across the rate families)
 *   plus the soonest replenish/`retry-after` time.
 *
 * Source for the documented headers + RFC-3339 reset format:
 *   https://platform.claude.com/docs/en/api/rate-limits ("Response headers").
 * The unified-5h/7d headers are undocumented and may change — that volatility
 * is the reason this whole module is one swappable seam.
 *
 * Security: the OAuth token / API key passed in is used ONLY as the request
 * credential. It is NEVER logged, returned, or persisted — only AccountKind and
 * numeric usage flow out of here.
 */

import { createLogger } from "@/lib/logger";
import type { ClaudeAccountKind } from "@/types/claude-limits";

const log = createLogger("AnthropicUsageAdapter");

/** The Messages endpoint we probe for rate-limit headers. */
const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
/** Pinned anthropic-version (matches the rest of the codebase's Claude calls). */
const ANTHROPIC_VERSION = "2023-06-01";
/** OAuth-token requests need this beta header on /v1/messages. */
const OAUTH_BETA = "oauth-2025-04-20";
/** A small, cheap model is fine — we only read headers, never the body. */
const PROBE_MODEL = "claude-haiku-4-5";
/** Probe timeout (ms): a usage poll must never hang a sweep. */
const PROBE_TIMEOUT_MS = 10_000;

/** The minimal `fetch` surface this module needs (injectable for tests). */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  }
) => Promise<{ status: number; headers: Headers }>;

/** Normalized usage reading for one Claude account. */
export interface ClaudeUsageSnapshot {
  /** 5h rolling window utilization, 0-100, or null if not reported. */
  window5hPct: number | null;
  /** 7d rolling window utilization, 0-100, or null if not reported. */
  window7dPct: number | null;
  /** When the 5h window resets, or null. */
  resetAt5h: Date | null;
  /** When the 7d window resets, or null. */
  resetAt7d: Date | null;
  /**
   * api_key only: worst-case utilization across the per-minute rate-limit
   * families (requests / input-tokens / output-tokens / tokens), 0-100, or null
   * when no rate header was reported. Null for subscription accounts.
   */
  orgPct: number | null;
  /**
   * api_key only: soonest the account frees up — the nearest rate-limit
   * `-reset`, or now + `retry-after` when currently 429'd. Null otherwise.
   */
  resetAtOrg: Date | null;
}

/**
 * Fetch a usage snapshot for the account behind `token`.
 *
 * @param token  The request credential: an OAuth access token (subscription)
 *   or a raw API key (api_key). Used only as the credential — never logged.
 * @param kind   The account kind, which selects the credential header and which
 *   rate-limit header family to read.
 * @param fetchImpl  Injected fetch (defaults to the global). Tests pass a fake
 *   returning a `Response`-shaped object with the real header names.
 * @returns A normalized snapshot, or null when usage cannot be determined
 *   (network/abort error, or no recognizable rate-limit headers).
 */
export async function fetchClaudeUsage(
  token: string,
  kind: ClaudeAccountKind = "subscription",
  fetchImpl: FetchLike = defaultFetch
): Promise<ClaudeUsageSnapshot | null> {
  if (!token) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(MESSAGES_URL, {
      method: "POST",
      headers: buildHeaders(token, kind),
      body: PROBE_BODY,
      signal: controller.signal,
    });
    // 200 (under limit) and 429 (over limit) BOTH carry the headers and are
    // useful reads. Other statuses (401/403/5xx) won't carry meaningful usage
    // headers, so snapshotFromHeaders yields an all-null snapshot we drop.
    const snapshot =
      kind === "api_key"
        ? apiKeySnapshot(response.headers)
        : subscriptionSnapshot(response.headers);
    if (snapshot && isInformative(snapshot)) {
      log.trace("Usage probe produced a snapshot", {
        kind,
        status: response.status,
      });
      return snapshot;
    }
    log.debug("Usage probe returned no usage headers", {
      kind,
      status: response.status,
    });
    return null;
  } catch (error) {
    // Best-effort: a probe failure (timeout/abort/network) is never fatal.
    log.warn("Usage probe failed", { kind, error: String(error) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** A one-token probe — we only want the headers, not a real completion. */
const PROBE_BODY = JSON.stringify({
  model: PROBE_MODEL,
  max_tokens: 1,
  messages: [{ role: "user", content: "." }],
});

/** Build the credential + version headers for the probe (token never logged). */
function buildHeaders(
  token: string,
  kind: ClaudeAccountKind
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
  };
  if (kind === "subscription") {
    // OAuth subscription tokens authenticate via Bearer + the oauth beta.
    headers["authorization"] = `Bearer ${token}`;
    headers["anthropic-beta"] = OAUTH_BETA;
  } else {
    // Raw API keys authenticate via x-api-key.
    headers["x-api-key"] = token;
  }
  return headers;
}

/** Default fetch wrapper that adapts the global fetch to {@link FetchLike}. */
const defaultFetch: FetchLike = (url, init) =>
  fetch(url, init).then((r) => ({ status: r.status, headers: r.headers }));

/**
 * Build a subscription snapshot from the unified 5h/7d headers.
 * Returns null only when neither window is present.
 */
function subscriptionSnapshot(headers: Headers): ClaudeUsageSnapshot | null {
  const w5h = windowUtilization(headers, "5h");
  const w7d = windowUtilization(headers, "7d");
  return {
    window5hPct: w5h,
    window7dPct: w7d,
    resetAt5h: parseResetHeader(
      headers.get("anthropic-ratelimit-unified-5h-reset")
    ),
    resetAt7d: parseResetHeader(
      headers.get("anthropic-ratelimit-unified-7d-reset")
    ),
    orgPct: null,
    resetAtOrg: null,
  };
}

/**
 * Build an api_key snapshot from the documented per-minute rate-limit headers.
 * Utilization is the WORST case across the rate families (the binding limit);
 * the reset is the soonest replenish, or now + retry-after when 429'd.
 */
function apiKeySnapshot(headers: Headers): ClaudeUsageSnapshot {
  const families = ["requests", "input-tokens", "output-tokens", "tokens"];

  let worstPct: number | null = null;
  let soonestReset: Date | null = null;
  for (const family of families) {
    const pct = familyUtilization(headers, family);
    if (pct !== null && (worstPct === null || pct > worstPct)) worstPct = pct;

    const reset = parseResetHeader(
      headers.get(`anthropic-ratelimit-${family}-reset`)
    );
    if (reset && (soonestReset === null || reset < soonestReset)) {
      soonestReset = reset;
    }
  }

  // A live 429 carries retry-after (seconds) — treat it as the binding reset
  // and pin utilization to 100 (no headroom right now).
  const retryAfter = parseRetryAfter(headers.get("retry-after"));
  if (retryAfter !== null) {
    worstPct = 100;
    const retryReset = new Date(Date.now() + retryAfter * 1000);
    if (soonestReset === null || retryReset < soonestReset) {
      soonestReset = retryReset;
    }
  }

  return {
    window5hPct: null,
    window7dPct: null,
    resetAt5h: null,
    resetAt7d: null,
    orgPct: worstPct,
    resetAtOrg: soonestReset,
  };
}

/**
 * Utilization for one unified subscription window: (limit - remaining) / limit
 * * 100, clamped to 0-100. Null when limit/remaining are absent or limit ≤ 0.
 */
function windowUtilization(
  headers: Headers,
  window: "5h" | "7d"
): number | null {
  const limit = parseNonNegInt(
    headers.get(`anthropic-ratelimit-unified-${window}-limit`)
  );
  const remaining = parseNonNegInt(
    headers.get(`anthropic-ratelimit-unified-${window}-remaining`)
  );
  return utilizationPct(limit, remaining);
}

/** Utilization for one documented api_key rate family (e.g. "requests"). */
function familyUtilization(headers: Headers, family: string): number | null {
  const limit = parseNonNegInt(
    headers.get(`anthropic-ratelimit-${family}-limit`)
  );
  const remaining = parseNonNegInt(
    headers.get(`anthropic-ratelimit-${family}-remaining`)
  );
  return utilizationPct(limit, remaining);
}

/** (limit - remaining) / limit * 100, clamped 0-100. Null if not derivable. */
function utilizationPct(
  limit: number | null,
  remaining: number | null
): number | null {
  if (limit === null || remaining === null || limit <= 0) return null;
  const used = limit - remaining;
  const pct = (used / limit) * 100;
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return Math.round(pct);
}

/**
 * Parse a rate-limit `-reset` header into a Date. The documented headers use
 * **RFC 3339** (e.g. `2025-06-13T15:00:00Z`); the undocumented unified headers
 * have historically carried a **unix epoch in seconds** (see
 * ReactiveOutputDetector). Accept both so neither family needs a special case.
 */
function parseResetHeader(raw: string | null): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // Pure digits → unix epoch seconds (the unified-header shape).
  if (/^\d{9,}$/.test(trimmed)) {
    const epochSec = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(epochSec) || epochSec <= 0) return null;
    return new Date(epochSec * 1000);
  }

  // Otherwise an RFC 3339 / ISO 8601 timestamp (the documented shape).
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/** Parse `retry-after` (seconds). Null when absent or non-positive. */
function parseRetryAfter(raw: string | null): number | null {
  if (!raw) return null;
  const seconds = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/** Parse a non-negative integer header value, or null. */
function parseNonNegInt(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Whether a snapshot carries at least one usable signal (else we drop it). */
function isInformative(snapshot: ClaudeUsageSnapshot): boolean {
  return (
    snapshot.window5hPct !== null ||
    snapshot.window7dPct !== null ||
    snapshot.resetAt5h !== null ||
    snapshot.resetAt7d !== null ||
    snapshot.orgPct !== null ||
    snapshot.resetAtOrg !== null
  );
}
