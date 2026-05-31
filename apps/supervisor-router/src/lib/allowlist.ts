/**
 * Last-known-good allowlist cache (spec §5, §15 M4).
 *
 * Polls the Supervisor's `GET /api/internal/routes` (gated by the shared
 * `x-supervisor-internal-secret` header) every `pollIntervalMs`, parses the
 * `{ routes }` map, and caches it. On a SUCCESSFUL poll it replaces the cache
 * and stamps `lastGoodAt`. On a FAILED poll it KEEPS the last-known-good cache
 * (fail-open — the router keeps routing known-ready slugs) and logs a warn;
 * it NEVER throws and NEVER wipes the cache.
 *
 * The first poll runs eagerly on `start()`; until it returns, the cache is
 * empty and unknown slugs 404 (fail-closed only at cold start, by definition —
 * there is no last-known-good yet).
 */

import { createLogger } from "@/lib/logger";
import type { AllowlistLookup, RouteEntry } from "@/lib/router-core";

const log = createLogger("Allowlist");

// --- SSRF guards: grammars every wire-supplied field must satisfy before it is
// allowed to compose the upstream authority (see `isSafeRouteEntry`). ---

/** Instance slug grammar (the route-table map key). Mirrors slug.ts. */
const SLUG_KEY_PATTERN = /^[a-z][a-z0-9-]{0,14}$/;
/** The §15 B2 per-instance namespace: `rdv-<slug>`. */
const NAMESPACE_PATTERN = /^rdv-[a-z][a-z0-9-]{0,14}$/;
/** A DNS-1035 label (the Service name lives inside the cluster DNS authority). */
const DNS_LABEL_PATTERN = /^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** A TCP port is an integer in 1..65535. */
function isValidPort(port: unknown): port is number {
  return typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= 65535;
}

/** The Supervisor's `/api/internal/routes` response shape (§15 B2). */
interface RoutesResponse {
  routes: Record<string, RouteEntry>;
}

export interface AllowlistCacheOptions {
  /** Base URL of the Supervisor, e.g. `http://supervisor.rdv-system.svc.cluster.local:6003`. */
  supervisorUrl: string;
  /** Shared secret presented as `x-supervisor-internal-secret`. May be empty in dev. */
  internalSecret: string;
  /** Poll cadence in ms. */
  pollIntervalMs: number;
  /** Per-request timeout in ms (default 5000). */
  fetchTimeoutMs?: number;
  /** Injectable fetch for tests (defaults to global fetch). */
  fetchImpl?: typeof fetch;
}

export class AllowlistCache implements AllowlistLookup {
  private readonly routesUrl: string;
  private readonly internalSecret: string;
  private readonly pollIntervalMs: number;
  private readonly fetchTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  private cache: Record<string, RouteEntry> = {};
  private lastGoodAt: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(opts: AllowlistCacheOptions) {
    // Normalize: join the base URL with the well-known internal path.
    this.routesUrl = new URL(
      "/api/internal/routes",
      opts.supervisorUrl,
    ).toString();
    this.internalSecret = opts.internalSecret;
    this.pollIntervalMs = opts.pollIntervalMs;
    this.fetchTimeoutMs = opts.fetchTimeoutMs ?? 5000;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /** Look up a ready instance by slug. Undefined if unknown / not cached. */
  lookup(slug: string): RouteEntry | undefined {
    return this.cache[slug];
  }

  /** Number of slugs currently cached (for logging/observability). */
  get size(): number {
    return Object.keys(this.cache).length;
  }

  /** Epoch ms of the last successful poll, or null if none yet. */
  get lastGoodAtMs(): number | null {
    return this.lastGoodAt;
  }

  /**
   * Run one poll. On success replaces the cache; on failure keeps the
   * last-known-good. Always resolves (never rejects) so it's safe to fire from
   * a timer without an unhandled rejection.
   */
  async pollOnce(): Promise<void> {
    if (this.polling) {
      // Overlapping poll (slow upstream + short interval) — skip this tick.
      return;
    }
    this.polling = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.fetchTimeoutMs);
    try {
      const headers: Record<string, string> = {};
      if (this.internalSecret) {
        headers["x-supervisor-internal-secret"] = this.internalSecret;
      }
      const res = await this.fetchImpl(this.routesUrl, {
        headers,
        signal: controller.signal,
      });
      if (!res.ok) {
        // Keep last-known-good; do not wipe.
        log.warn("Allowlist poll returned non-OK; keeping last-known-good", {
          status: res.status,
          cached: this.size,
        });
        return;
      }
      const body = (await res.json()) as Partial<RoutesResponse>;
      const next = this.normalizeRoutes(body?.routes);
      this.cache = next;
      this.lastGoodAt = Date.now();
      log.debug("Allowlist refreshed", { slugs: this.size });
    } catch (error) {
      // Network error / timeout / parse error → fail open from cache.
      log.warn("Allowlist poll failed; keeping last-known-good", {
        error: String(error),
        cached: this.size,
      });
    } finally {
      clearTimeout(timeout);
      this.polling = false;
    }
  }

  /**
   * Validate + copy the routes map, DROPPING any entry that fails a strict check
   * (with a warn). This is a security boundary, not just a shape check: every
   * field flows into the upstream authority
   * `${service}.${namespace}.svc.cluster.local:${port}` (§15 B2), so a
   * misconfigured/compromised Supervisor — or a MITM of the internal poll —
   * could otherwise inject an authority that redirects the proxy (SSRF). We
   * regex-validate each field against its DNS/port grammar rather than trusting
   * the wire, and resolve only from entries that pass ALL checks.
   */
  private normalizeRoutes(
    routes: Record<string, RouteEntry> | undefined,
  ): Record<string, RouteEntry> {
    const out: Record<string, RouteEntry> = {};
    if (!routes || typeof routes !== "object") return out;
    for (const [slug, entry] of Object.entries(routes)) {
      if (this.isSafeRouteEntry(slug, entry)) {
        out[slug] = {
          namespace: entry.namespace,
          service: entry.service,
          httpPort: entry.httpPort,
          wsPort: entry.wsPort,
          ready: true,
        };
      } else {
        // Never log the raw entry verbatim (could be attacker-controlled and
        // noisy); just the key, which we know is a string map key.
        log.warn("Dropping invalid/unsafe allowlist entry", { slug });
      }
    }
    return out;
  }

  /**
   * Strict per-entry validation guarding the upstream-authority construction.
   * Returns true only when EVERY field is well-formed:
   * - slug (map key): the instance slug grammar `^[a-z][a-z0-9-]{0,14}$`
   * - namespace: `^rdv-<slug>$` (the §15 B2 namespace model)
   * - service: a DNS-1035 label
   * - httpPort/wsPort: integers in 1..65535
   * - ready === true (the allowlist only ever holds ready instances)
   */
  private isSafeRouteEntry(
    slug: string,
    entry: RouteEntry | undefined,
  ): entry is RouteEntry {
    if (!entry || typeof entry !== "object") return false;
    if (typeof slug !== "string" || !SLUG_KEY_PATTERN.test(slug)) return false;
    if (
      typeof entry.namespace !== "string" ||
      !NAMESPACE_PATTERN.test(entry.namespace)
    ) {
      return false;
    }
    if (
      typeof entry.service !== "string" ||
      !DNS_LABEL_PATTERN.test(entry.service)
    ) {
      return false;
    }
    if (!isValidPort(entry.httpPort) || !isValidPort(entry.wsPort)) {
      return false;
    }
    if (entry.ready !== true) return false;
    return true;
  }

  /** Start the poll loop: one eager poll, then on the interval. */
  start(): void {
    if (this.timer) return;
    log.info("Allowlist poller starting", {
      url: this.routesUrl,
      intervalMs: this.pollIntervalMs,
      authenticated: this.internalSecret.length > 0,
    });
    void this.pollOnce();
    this.timer = setInterval(() => void this.pollOnce(), this.pollIntervalMs);
    // Don't keep the event loop alive solely for the poll timer.
    if (typeof this.timer === "object" && "unref" in this.timer) {
      this.timer.unref();
    }
  }

  /** Stop the poll loop. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
