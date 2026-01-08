/**
 * Simple in-memory rate limiter for API routes
 *
 * Tracks request counts per identifier (user ID or IP) within a sliding window.
 * Returns rate limit information and whether the request should be allowed.
 *
 * Note: This is an in-memory implementation suitable for single-server deployments.
 * For multi-server deployments, consider using Redis or a distributed rate limiter.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number; // Unix timestamp in milliseconds
}

// Store: identifier -> rate limit entry
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries periodically (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

export interface RateLimitOptions {
  /**
   * Maximum number of requests allowed within the window
   */
  limit: number;
  /**
   * Time window in milliseconds
   */
  windowMs: number;
}

export interface RateLimitResult {
  /**
   * Whether the request is allowed
   */
  allowed: boolean;
  /**
   * Maximum requests allowed
   */
  limit: number;
  /**
   * Remaining requests in current window
   */
  remaining: number;
  /**
   * Unix timestamp when the rate limit resets
   */
  resetAt: number;
  /**
   * Number of requests made in current window
   */
  current: number;
}

/**
 * Check if a request should be rate limited
 *
 * @param identifier - Unique identifier for the client (user ID, IP address, etc.)
 * @param options - Rate limit configuration
 * @returns Rate limit result
 *
 * @example
 * ```ts
 * const result = checkRateLimit(userId, { limit: 100, windowMs: 60000 }); // 100 requests per minute
 * if (!result.allowed) {
 *   return NextResponse.json(
 *     { error: "Rate limit exceeded" },
 *     {
 *       status: 429,
 *       headers: {
 *         "X-RateLimit-Limit": result.limit.toString(),
 *         "X-RateLimit-Remaining": "0",
 *         "X-RateLimit-Reset": result.resetAt.toString(),
 *       },
 *     }
 *   );
 * }
 * ```
 */
export function checkRateLimit(
  identifier: string,
  options: RateLimitOptions
): RateLimitResult {
  const now = Date.now();
  const entry = rateLimitStore.get(identifier);

  // No entry or expired entry - create new one
  if (!entry || entry.resetAt < now) {
    const resetAt = now + options.windowMs;
    rateLimitStore.set(identifier, {
      count: 1,
      resetAt,
    });

    return {
      allowed: true,
      limit: options.limit,
      remaining: options.limit - 1,
      resetAt,
      current: 1,
    };
  }

  // Entry exists and is still valid
  entry.count += 1;

  const allowed = entry.count <= options.limit;
  const remaining = Math.max(0, options.limit - entry.count);

  return {
    allowed,
    limit: options.limit,
    remaining,
    resetAt: entry.resetAt,
    current: entry.count,
  };
}

/**
 * Create rate limit response headers
 */
export function createRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": result.limit.toString(),
    "X-RateLimit-Remaining": result.remaining.toString(),
    "X-RateLimit-Reset": result.resetAt.toString(),
    "Retry-After": Math.ceil((result.resetAt - Date.now()) / 1000).toString(),
  };
}

/**
 * Get rate limit status without incrementing counter
 * Useful for checking limits before expensive operations
 */
export function getRateLimitStatus(
  identifier: string,
  options: RateLimitOptions
): RateLimitResult {
  const now = Date.now();
  const entry = rateLimitStore.get(identifier);

  if (!entry || entry.resetAt < now) {
    return {
      allowed: true,
      limit: options.limit,
      remaining: options.limit,
      resetAt: now + options.windowMs,
      current: 0,
    };
  }

  const allowed = entry.count < options.limit;
  const remaining = Math.max(0, options.limit - entry.count);

  return {
    allowed,
    limit: options.limit,
    remaining,
    resetAt: entry.resetAt,
    current: entry.count,
  };
}

/**
 * Reset rate limit for an identifier (useful for testing or admin overrides)
 */
export function resetRateLimit(identifier: string): void {
  rateLimitStore.delete(identifier);
}

/**
 * Get all rate limit entries (useful for monitoring)
 */
export function getAllRateLimitEntries(): Map<string, RateLimitEntry> {
  return new Map(rateLimitStore);
}

/**
 * Clear all rate limit entries
 */
export function clearAllRateLimits(): void {
  rateLimitStore.clear();
}
