/**
 * anthropic-usage-adapter - The ONE volatile seam for proactive usage polling.
 *
 * Reads a Claude account's usage headroom WITHOUT sending a message (no quota
 * burn) from the structured OAuth usage endpoint:
 *
 *   GET https://api.anthropic.com/api/oauth/usage
 *     Authorization: Bearer <oauth access token>
 *     anthropic-beta: oauth-2025-04-20
 *     anthropic-version: 2023-06-01
 *
 * ALL knowledge of the wire format lives here behind a single function;
 * everything upstream (the poller, the gateway, the use-cases) depends only on
 * the normalized {@link ClaudeUsageSnapshot}.
 *
 * ## Why this replaced the old header scrape [remote-dev-n4x4.1]
 *
 * The previous implementation POSTed a 1-token probe to `/v1/messages` and read
 * `anthropic-ratelimit-unified-{5h,7d}-{limit,remaining}` off the response.
 * **Those two header names do not exist.** The real unified headers are
 * `-utilization` (a 0-1 fraction), `-status`, `-reset`, `-representative-claim`,
 * `-fallback`, `-fallback-percentage`, `-overage-status` and
 * `-overage-disabled-reason`. Consequence: both windows always parsed as null,
 * the snapshot was never informative, and `fetchClaudeUsage` returned null
 * unconditionally — the poller was inert even with the flag on. The probe is
 * gone; there is no `/v1/messages` request in this module any more.
 *
 * ## Response shape (verified live against a Max subscription, 2026-07-28)
 *
 * ```jsonc
 * {
 *   "five_hour": { "utilization": 61.0, "resets_at": "2026-07-28T14:40:00Z", ... },
 *   "seven_day": { "utilization": 98.0, "resets_at": "2026-07-30T22:59:59Z", ... },
 *   "seven_day_opus": null, "seven_day_sonnet": null, ...   // legacy, all null
 *   "limits": [
 *     { "kind": "session",       "group": "session", "percent": 61,  "severity": "normal",
 *       "resets_at": "...", "scope": null, "is_active": false },
 *     { "kind": "weekly_all",    "group": "weekly",  "percent": 98,  "severity": "critical",
 *       "resets_at": "...", "scope": null, "is_active": false },
 *     { "kind": "weekly_scoped", "group": "weekly",  "percent": 100, "severity": "critical",
 *       "resets_at": "...", "is_active": true,
 *       "scope": { "model": { "id": null, "display_name": "Fable" }, "surface": null } }
 *   ]
 * }
 * ```
 *
 * Load-bearing details, all encoded below:
 *
 * - `limits[]` is PRIMARY. The flat legacy per-model fields
 *   (`seven_day_opus`, `seven_day_sonnet`, `seven_day_cowork`, …) are all null
 *   and superseded; we never read them. `five_hour` / `seven_day` are used only
 *   as a FALLBACK when `limits[]` is absent or empty.
 * - `kind` and `severity` are OPEN string sets (observed: `session` /
 *   `weekly_all` / `weekly_scoped`, and `normal` / `critical`). Unknown values
 *   round-trip verbatim instead of being dropped or throwing.
 * - Per-model identity is `scope.model.display_name` ONLY — `scope.model.id` is
 *   null in practice, so matching is by display name.
 * - `percent` is a 0-100 integer and the `utilization` fields are 0-100 floats.
 *   (The *response headers* use a 0-1 fraction; do not conflate the scales.)
 *
 * ## Throttling (verified live 2026-08-03) [remote-dev-u7df]
 *
 * The read is free of QUOTA but not of RATE LIMIT: Anthropic throttled the
 * observed long-lived `claude setup-token` credentials on this endpoint to
 * roughly one request per hour per token. Excess reads get HTTP 429 with a
 * `retry-after` header (observed: `retry-after: 3578` seconds, counting down
 * toward a fixed reset). Short-lived Keychain access tokens are NOT throttled
 * this way (proven: simultaneous 200 vs 429 from the same IP). Caveat
 * [remote-dev-307w]: the three observed tokens later turned out to be
 * TRUNCATED, INVALID credentials, so the hourly figure is only confirmed for
 * rejected tokens — the cadence allowed a VALID setup-token is unverified.
 * The app stores setup-tokens either way, so a sub-hourly cadence must expect
 * 429s.
 * {@link fetchClaudeUsage} therefore surfaces a 429 as a first-class
 * "rate-limited" outcome carrying the reset time, so the sweep can align its
 * next attempt to the quota window instead of discarding the header and
 * backing off blind.
 *
 * ## api_key accounts
 *
 * This endpoint is subscription-only: it describes claude.ai rolling windows
 * that a raw API key does not have. Raw keys are governed by the documented
 * per-minute rate-limit headers (`anthropic-ratelimit-{requests,input-tokens,
 * output-tokens,tokens}-{limit,remaining,reset}` + `retry-after`, see
 * https://platform.claude.com/docs/en/api/rate-limits) which ride on Messages
 * API responses — there is no free endpoint that reports them. That parsing is
 * preserved and exported as {@link apiKeyUsageFromHeaders} so a caller that
 * already holds such a response can normalize it; `fetchClaudeUsage` itself no
 * longer issues a request for api_key (it never had a credential to use — see
 * `UsageEndpointPoller`, which now only supports subscription).
 *
 * Security: the OAuth token passed in is used ONLY as the request credential.
 * It is NEVER logged, returned, or persisted — only AccountKind and numeric
 * usage flow out of here.
 */

import { createLogger } from "@/lib/logger";
import type { ClaudeAccountKind } from "@/types/claude-limits";

const log = createLogger("AnthropicUsageAdapter");

/** The structured usage endpoint (subscription / OAuth accounts only). */
const OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
/** Pinned anthropic-version (matches the rest of the codebase's Claude calls). */
const ANTHROPIC_VERSION = "2023-06-01";
/** OAuth-token requests need this beta header. */
const OAUTH_BETA = "oauth-2025-04-20";
/** Request timeout (ms): a usage poll must never hang a sweep. */
const REQUEST_TIMEOUT_MS = 10_000;

/** The minimal `fetch` surface this module needs (injectable for tests). */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    signal?: AbortSignal;
  }
) => Promise<{
  status: number;
  headers: Headers;
  text: () => Promise<string>;
}>;

/**
 * One entry of the endpoint's `limits[]` array, normalized.
 *
 * `kind`, `group` and `severity` are deliberately plain strings: the endpoint's
 * vocabularies are open, so an unrecognized value must survive the round trip
 * rather than crash the poll or be silently dropped.
 */
export interface ClaudeUsageLimitEntry {
  /** Open set. Observed: "session" | "weekly_all" | "weekly_scoped". */
  kind: string;
  /** Open set. Observed: "session" | "weekly". Null when not reported. */
  group: string | null;
  /** Utilization 0-100 (integer, clamped). */
  percent: number;
  /** Open set. Observed: "normal" | "critical". Null when not reported. */
  severity: string | null;
  /** When this window resets, or null. */
  resetAt: Date | null;
  /**
   * The scoped model's DISPLAY NAME (e.g. "Fable"), or null for an
   * account-level window. `scope.model.id` is null upstream, so the display
   * name is the only usable per-model identity.
   */
  scopeModel: string | null;
  /** The scoped surface, or null. Always null in observed responses. */
  scopeSurface: string | null;
  /** Whether this limit is the one actually binding right now. */
  isActive: boolean;
}

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
  /**
   * Every window the endpoint reported, including per-model
   * (`weekly_scoped`) ones. Empty when the endpoint reported no `limits[]`
   * (the 5h/7d fallback path) or for api_key accounts.
   */
  limits: ClaudeUsageLimitEntry[];
}

/**
 * The outcome of one usage read, discriminated so a caller can tell "here is
 * a snapshot" from "the endpoint refused with retry-after" from "no data".
 * [remote-dev-u7df] The 429 case used to collapse into a bare null and the
 * `retry-after` header — the only signal that names the quota reset — was
 * discarded.
 */
export type ClaudeUsageFetchResult =
  | { outcome: "snapshot"; snapshot: ClaudeUsageSnapshot }
  | { outcome: "rate-limited"; retryAt: Date }
  | { outcome: "no-data" };

/** The dataless outcome (shared: it carries nothing case-specific). */
const NO_DATA: ClaudeUsageFetchResult = { outcome: "no-data" };

/**
 * Fetch a usage snapshot for the account behind `token`.
 *
 * @param token  The OAuth access token for a subscription account. Used only as
 *   the request credential — never logged.
 * @param kind   The account kind. Only "subscription" is fetchable here; see
 *   the module docblock for why api_key yields no data.
 * @param fetchImpl  Injected fetch (defaults to the global). Tests pass a fake.
 * @returns A "snapshot" outcome carrying the normalized snapshot; a
 *   "rate-limited" outcome carrying the reset time when the endpoint 429'd
 *   with a usable `retry-after` (see the Throttling section of the module
 *   docblock); or "no-data" when usage cannot be determined (unsupported kind,
 *   network/abort error, other non-200, a 429 without a usable retry-after,
 *   malformed body, or a body carrying no recognizable usage).
 */
export async function fetchClaudeUsage(
  token: string,
  kind: ClaudeAccountKind = "subscription",
  fetchImpl: FetchLike = defaultFetch
): Promise<ClaudeUsageFetchResult> {
  if (!token) return NO_DATA;

  if (kind !== "subscription") {
    // The OAuth usage endpoint has no api_key equivalent, and a raw key's
    // rate-limit headers only ride on Messages API responses (which we will
    // not send — that would burn quota). A caller holding such a response can
    // normalize it via apiKeyUsageFromHeaders().
    log.debug("No free usage read for this account kind; skipping", { kind });
    return NO_DATA;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(OAUTH_USAGE_URL, {
      method: "GET",
      headers: buildHeaders(token),
      signal: controller.signal,
    });

    if (response.status === 429) {
      // See the module docblock's Throttling section: setup-token credentials
      // get ~1 read/hour, so this is the EXPECTED steady-state response under
      // a sub-hourly cadence — surface the reset instead of eating it.
      const retryAfterSeconds = parseRetryAfter(
        response.headers.get("retry-after")
      );
      if (retryAfterSeconds === null) {
        // Nothing to align to; the caller falls back to plain failure backoff.
        log.warn("Usage endpoint rate-limited without a usable retry-after", {
          status: response.status,
        });
        return NO_DATA;
      }
      const retryAt = new Date(Date.now() + retryAfterSeconds * 1000);
      log.warn("Usage endpoint rate-limited the credential", {
        status: response.status,
        retryAfterSeconds,
        retryAt: retryAt.toISOString(),
      });
      return { outcome: "rate-limited", retryAt };
    }

    if (response.status !== 200) {
      log.warn("Usage endpoint returned a non-200", {
        status: response.status,
      });
      return NO_DATA;
    }

    const body = await parseBody(response);
    if (!body) return NO_DATA;

    const snapshot = snapshotFromUsageBody(body);
    if (!isInformative(snapshot)) {
      log.debug("Usage endpoint returned no usable windows", {
        status: response.status,
      });
      return NO_DATA;
    }

    log.trace("Usage read produced a snapshot", {
      status: response.status,
      limits: snapshot.limits.length,
    });
    return { outcome: "snapshot", snapshot };
  } catch (error) {
    // Best-effort: a read failure (timeout/abort/network) is never fatal.
    log.warn("Usage read failed", { kind, error: String(error) });
    return NO_DATA;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Normalize the documented per-minute rate-limit headers of an api_key
 * response into a snapshot. Utilization is the WORST case across the rate
 * families (the binding limit); the reset is the soonest replenish, or
 * now + `retry-after` when currently 429'd.
 *
 * Exported (rather than called here) because the raw key lives behind the
 * secrets path and no free endpoint reports these headers — see the module
 * docblock.
 */
export function apiKeyUsageFromHeaders(headers: Headers): ClaudeUsageSnapshot {
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
    limits: [],
  };
}

/** Whether a snapshot carries at least one usable signal (else we drop it). */
export function isInformative(snapshot: ClaudeUsageSnapshot): boolean {
  return (
    snapshot.limits.length > 0 ||
    snapshot.window5hPct !== null ||
    snapshot.window7dPct !== null ||
    snapshot.resetAt5h !== null ||
    snapshot.resetAt7d !== null ||
    snapshot.orgPct !== null ||
    snapshot.resetAtOrg !== null
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Request plumbing
// ─────────────────────────────────────────────────────────────────────────────

/** Build the credential + version headers (token never logged). */
function buildHeaders(token: string): Record<string, string> {
  return {
    accept: "application/json",
    authorization: `Bearer ${token}`,
    "anthropic-beta": OAUTH_BETA,
    "anthropic-version": ANTHROPIC_VERSION,
  };
}

/** Default fetch wrapper that adapts the global fetch to {@link FetchLike}. */
const defaultFetch: FetchLike = (url, init) =>
  fetch(url, init).then((r) => ({
    status: r.status,
    headers: r.headers,
    text: () => r.text(),
  }));

/** Read + JSON-parse the response body. Null on malformed or non-object JSON. */
async function parseBody(response: {
  text: () => Promise<string>;
}): Promise<Record<string, unknown> | null> {
  const raw = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    log.warn("Usage endpoint returned malformed JSON");
    return null;
  }
  if (!isRecord(parsed)) {
    log.warn("Usage endpoint returned a non-object body");
    return null;
  }
  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Body → snapshot
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the snapshot from a parsed `/api/oauth/usage` body.
 *
 * `limits[]` is primary; `five_hour` / `seven_day` are consulted only for the
 * rollup dimensions `limits[]` did not supply (i.e. when it is absent/empty, or
 * carries no `session` / `weekly_all` entry).
 */
export function snapshotFromUsageBody(
  body: Record<string, unknown>
): ClaudeUsageSnapshot {
  const limits = parseLimits(body["limits"]);

  // Account-level rollup. The 5h slot is the session window; the 7d slot is the
  // ACCOUNT-level weekly window (`weekly_all`) — deliberately NOT the worst
  // scoped window, so a single exhausted per-model window (e.g. Fable) does not
  // mark the whole account limited. Per-model awareness reads `limits[]`.
  const session = limits.find((l) => l.kind === "session");
  const weeklyAll = limits.find((l) => l.kind === "weekly_all");

  const fiveHour = parseWindow(body["five_hour"]);
  const sevenDay = parseWindow(body["seven_day"]);

  return {
    window5hPct: session ? session.percent : fiveHour.percent,
    window7dPct: weeklyAll ? weeklyAll.percent : sevenDay.percent,
    resetAt5h: session ? session.resetAt : fiveHour.resetAt,
    resetAt7d: weeklyAll ? weeklyAll.resetAt : sevenDay.resetAt,
    orgPct: null,
    resetAtOrg: null,
    limits,
  };
}

/** Parse a `five_hour` / `seven_day` object into its two usable dimensions. */
function parseWindow(raw: unknown): {
  percent: number | null;
  resetAt: Date | null;
} {
  if (!isRecord(raw)) return { percent: null, resetAt: null };
  return {
    // `utilization` here is a 0-100 float (unlike the 0-1 response headers).
    percent: parsePercent(raw["utilization"]),
    resetAt: parseTimestamp(raw["resets_at"]),
  };
}

/**
 * Parse `limits[]`. Entries without a usable `kind` are dropped (they carry no
 * identity); everything else — including unknown kinds and severities — is
 * preserved verbatim.
 */
function parseLimits(raw: unknown): ClaudeUsageLimitEntry[] {
  if (!Array.isArray(raw)) return [];

  const entries: ClaudeUsageLimitEntry[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const kind = parseNonEmptyString(item["kind"]);
    if (kind === null) continue;

    const scope = isRecord(item["scope"]) ? item["scope"] : null;
    const model = scope && isRecord(scope["model"]) ? scope["model"] : null;

    entries.push({
      kind,
      group: parseNonEmptyString(item["group"]),
      percent: parsePercent(item["percent"]) ?? 0,
      severity: parseNonEmptyString(item["severity"]),
      resetAt: parseTimestamp(item["resets_at"]),
      // `scope.model.id` is null upstream — display_name is the only identity.
      scopeModel: model ? parseNonEmptyString(model["display_name"]) : null,
      scopeSurface: scope ? parseNonEmptyString(scope["surface"]) : null,
      isActive: item["is_active"] === true,
    });
  }
  return entries;
}

// ─────────────────────────────────────────────────────────────────────────────
// api_key rate-limit header parsing (documented headers)
// ─────────────────────────────────────────────────────────────────────────────

/** Utilization for one documented api_key rate family (e.g. "requests"). */
function familyUtilization(headers: Headers, family: string): number | null {
  const limit = parseNonNegInt(
    headers.get(`anthropic-ratelimit-${family}-limit`)
  );
  const remaining = parseNonNegInt(
    headers.get(`anthropic-ratelimit-${family}-remaining`)
  );
  if (limit === null || remaining === null || limit <= 0) return null;
  return clampPercent(((limit - remaining) / limit) * 100);
}

/**
 * Parse a rate-limit `-reset` header into a Date. The documented headers use
 * **RFC 3339** (e.g. `2025-06-13T15:00:00Z`); unified headers have historically
 * carried a **unix epoch in seconds** (see ReactiveOutputDetector). Accept both.
 */
function parseResetHeader(raw: string | null): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // Pure digits → unix epoch seconds.
  if (/^\d{9,}$/.test(trimmed)) {
    const epochSec = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(epochSec) || epochSec <= 0) return null;
    return new Date(epochSec * 1000);
  }

  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/**
 * Parse a `retry-after` header into whole seconds. Accepts BOTH documented
 * forms: an integer delta ("3578", where "0" is valid RFC — retry now) and an
 * HTTP-date, converted to a delta from now (rounded up so a retry never lands
 * early). The HTTP-date form is exposed to local clock skew; the
 * integer-seconds form — the only one observed live — is relative and immune.
 * Null when absent, unparseable, or (HTTP-date) not in the future — callers
 * treat that as a plain failure.
 */
function parseRetryAfter(raw: string | null): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // Integer delta-seconds form. Checked before Date.parse, which would read
  // pure digits as a year. Zero is meaningful: retryAt = now, and the sweep's
  // max(retryAt, now) + jitter scheduling handles it.
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  }

  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) return null;
  const deltaSeconds = Math.ceil((ms - Date.now()) / 1000);
  return deltaSeconds > 0 ? deltaSeconds : null;
}

/** Parse a non-negative integer header value, or null. */
function parseNonNegInt(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Small value parsers
// ─────────────────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A 0-100 percentage, rounded and clamped. Null when not a finite number. */
function parsePercent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return clampPercent(value);
}

function clampPercent(value: number): number {
  if (value <= 0) return 0;
  if (value >= 100) return 100;
  return Math.round(value);
}

/** An ISO-8601 timestamp string, or null when absent/unparseable. */
function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/** A non-empty trimmed string, or null. */
function parseNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
