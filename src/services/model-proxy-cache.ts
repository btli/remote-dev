/**
 * In-process caching + rate-limiting for the centralized model-key proxy.
 *
 * Two independent mechanisms, both per Next.js server process (no extra deps):
 *
 *  - `allowRequest(key)` — token-bucket rate limiter keyed by tokenId (falls
 *    back to userId at the call site). Refills at RDV_MODEL_PROXY_RPS/sec up to
 *    a RDV_MODEL_PROXY_BURST ceiling.
 *
 *  - `cacheGet` / `cacheSet` — small LRU response cache for NON-streaming,
 *    DETERMINISTIC (temperature 0) requests only. DISABLED BY DEFAULT
 *    (RDV_MODEL_PROXY_CACHE_TTL_MS=0). Streaming SSE and non-deterministic
 *    sampling are never cached; cache hits bypass the upstream (and the meter),
 *    which is correct since a cached response incurs no upstream cost.
 *
 * NOTE: under multi-instance hosting these limits/caches are per-pod, not
 * global. Acceptable for v1; a shared store (libsql/Redis) is a follow-up.
 */
import { createHash } from "node:crypto";

interface CacheConfig {
  rate: number; // refill tokens/sec
  burst: number; // bucket ceiling
  ttlMs: number; // 0 = cache disabled
  maxEntries: number; // LRU cap
}

function configFromEnv(): CacheConfig {
  return {
    rate: Number(process.env.RDV_MODEL_PROXY_RPS ?? 5),
    burst: Number(process.env.RDV_MODEL_PROXY_BURST ?? 20),
    ttlMs: Number(process.env.RDV_MODEL_PROXY_CACHE_TTL_MS ?? 0),
    maxEntries: Number(process.env.RDV_MODEL_PROXY_CACHE_MAX ?? 200),
  };
}

let config: CacheConfig = configFromEnv();

interface Bucket {
  tokens: number;
  updated: number;
}
const buckets = new Map<string, Bucket>();

interface CacheEntry {
  body: string;
  status: number;
  at: number;
}
// JS Map preserves insertion order, giving us cheap LRU eviction (delete+reinsert
// on access, evict the first key when over cap).
const cache = new Map<string, CacheEntry>();

/**
 * Token-bucket admission check. Returns true if the request is allowed (and
 * consumes a token), false if the bucket is empty (→ caller returns 429).
 */
export function allowRequest(key: string): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: config.burst, updated: now };
  b.tokens = Math.min(config.burst, b.tokens + ((now - b.updated) / 1000) * config.rate);
  b.updated = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return true;
}

/**
 * Deterministic cache key for a request. The caller's tenant scope (userId +
 * instanceSlug) is folded in so a cached deterministic completion is NEVER
 * served across tenants under multi-instance hosting — even an identical body
 * from a different user/instance gets a distinct key. (The cache is off by
 * default, but this proxy targets multi-tenant supervisor instances.)
 */
export function cacheKey(
  scope: { userId: string; instanceSlug: string | null },
  provider: string,
  body: string,
): string {
  return createHash("sha256")
    .update(`${scope.userId}\n${scope.instanceSlug ?? ""}\n${provider}\n${body}`)
    .digest("hex");
}

/** Look up a cached response. Returns null when disabled, missing, or expired. */
export function cacheGet(key: string): { body: string; status: number } | null {
  if (config.ttlMs <= 0) return null;
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > config.ttlMs) {
    cache.delete(key);
    return null;
  }
  // LRU touch: move to most-recently-used.
  cache.delete(key);
  cache.set(key, e);
  return { body: e.body, status: e.status };
}

/** Store a response. No-op when caching is disabled. Evicts oldest past cap. */
export function cacheSet(key: string, v: { body: string; status: number }): void {
  if (config.ttlMs <= 0) return;
  cache.set(key, { body: v.body, status: v.status, at: Date.now() });
  while (cache.size > config.maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Test-only reset of the in-memory state + (optional) config overrides. Not for
 * production use.
 */
export function __resetModelProxyCacheForTest(overrides?: Partial<CacheConfig>): void {
  config = { ...configFromEnv(), ...overrides };
  buckets.clear();
  cache.clear();
}
