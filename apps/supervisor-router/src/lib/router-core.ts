/**
 * Pure routing decision for the Supervisor router (spec §5, §15 B2/M4/M5).
 *
 * Single front door (Option C): the router is the ONE external entry behind the
 * Cloudflare tunnel for the instance host (e.g. `dev.example.com`). It proxies
 * `/<slug>/*` to the matching instance Service and proxies everything else —
 * root `/`, `/login`, `/api/*`, assets — to the **Supervisor dashboard** on the
 * same host. There is no second hostname and no second Cloudflare Access app;
 * auth isolation between the dashboard and instances is by policy within the one
 * CF Access app (the router forwards `CF_Authorization` untouched either way).
 *
 * Given a request's pathname, whether it's a WebSocket upgrade, an allowlist
 * lookup, and the Supervisor's HTTP/WS bases, this returns a typed decision. It
 * performs NO I/O — that makes it the unit-testable core. `index.ts` executes
 * the decision (HTTP proxy / WS upgrade / local response).
 *
 * Routing is convention-based with NO prefix stripping: the instance image is
 * slug-aware and genuinely serves under `/<slug>`, and the Supervisor serves at
 * root, so the router forwards the full path (and query) UNCHANGED in both cases.
 */

import { isReserved, isValidSlug } from "@/lib/slug";

/** The route table entry the Supervisor returns per ready slug (§15 B2). */
export interface RouteEntry {
  namespace: string;
  service: string;
  httpPort: number;
  wsPort: number;
  ready: boolean;
}

/** Minimal allowlist surface the decision needs (no I/O). */
export interface AllowlistLookup {
  lookup(slug: string): RouteEntry | undefined;
}

export type RouteDecision =
  | { kind: "health" }
  /** `/api/internal/*` — answered 404 locally, NEVER proxied (defense-in-depth). */
  | { kind: "blocked" }
  | {
      kind: "proxy-http";
      /**
       * For an instance: `http://rdv.rdv-alpha.svc.cluster.local:6001`.
       * For the Supervisor default: its HTTP base (no trailing slash).
       */
      upstreamBase: string;
      /** The path to forward UNCHANGED (no query — caller appends search). */
      path: string;
      /** The instance slug, or `""` when proxying to the Supervisor. */
      slug: string;
    }
  | {
      kind: "proxy-ws";
      /**
       * For an instance: `ws://rdv.rdv-alpha.svc.cluster.local:6002`.
       * For the Supervisor default: its WS base (no trailing slash).
       */
      upstreamWsBase: string;
      /** The path to forward UNCHANGED. */
      path: string;
      /** The instance slug, or `""` when proxying to the Supervisor. */
      slug: string;
    };

/** Router liveness path — answered locally, never proxied (§5). */
export const HEALTH_PATH = "/healthz";

/**
 * The Supervisor's HTTP + WS bases (no trailing slash), derived from
 * `ROUTER_SUPERVISOR_URL`. The Supervisor is the DEFAULT proxy upstream — the
 * router fronts its dashboard at root on the same host.
 */
export interface SupervisorBases {
  /** e.g. `http://supervisor.rdv-system.svc.cluster.local:6003`. */
  httpBase: string;
  /** e.g. `ws://supervisor.rdv-system.svc.cluster.local:6003`. */
  wsBase: string;
}

/**
 * Build the in-cluster DNS authority for an instance Service from its route
 * entry: `<service>.<namespace>.svc.cluster.local`. With the §15 B2 namespace
 * model (`service=rdv`, `namespace=rdv-<slug>`) this is
 * `rdv.rdv-<slug>.svc.cluster.local`.
 */
export function upstreamAuthority(entry: RouteEntry): string {
  return `${entry.service}.${entry.namespace}.svc.cluster.local`;
}

/**
 * Extract the first path segment (the candidate slug) from a pathname.
 * Returns "" for the root path `/`.
 */
export function firstSegment(pathname: string): string {
  // Strip the leading slash, then take up to the next slash.
  const withoutLeading = pathname.startsWith("/")
    ? pathname.slice(1)
    : pathname;
  const slash = withoutLeading.indexOf("/");
  return slash === -1 ? withoutLeading : withoutLeading.slice(0, slash);
}

/**
 * Decide how to handle a request.
 *
 * The Supervisor is the DEFAULT upstream: anything that isn't a ready-instance
 * `/<slug>/…` path (root, reserved segments, valid-but-not-ready slugs,
 * malformed segments) is proxied to the Supervisor dashboard UNCHANGED.
 *
 * @param pathname   URL pathname (no query string), e.g. `/alpha/api/foo`.
 * @param isUpgrade  whether this is a WebSocket upgrade request.
 * @param allowlist  last-known-good ready-instance lookup.
 * @param supervisor the Supervisor's HTTP + WS bases (the default upstream).
 */
export function decideRoute(
  pathname: string,
  isUpgrade: boolean,
  allowlist: AllowlistLookup,
  supervisor: SupervisorBases,
): RouteDecision {
  // 1. Router liveness — answered locally FIRST (the router's own `/healthz`,
  //    checked before everything else so it can never be proxied to the
  //    Supervisor or shadowed by a reserved-slug rule).
  if (pathname === HEALTH_PATH) {
    return { kind: "health" };
  }

  // 2. The router's internal control surface — `/api/internal/*` is answered
  //    404 locally and NEVER proxied (defense-in-depth: the Supervisor's
  //    `/api/internal/routes` allowlist endpoint must not be reachable through
  //    the public front door). The router's OWN allowlist poll hits
  //    ROUTER_SUPERVISOR_URL directly (not via decideRoute), so blocking it
  //    here is safe.
  if (
    pathname === "/api/internal" ||
    pathname.startsWith("/api/internal/")
  ) {
    return { kind: "blocked" };
  }

  // 3. Instance match. Only a non-empty, non-reserved, well-formed first
  //    segment that is a KNOWN ready instance proxies to that instance. The
  //    allowlist only contains ready instances, so unknown/not-ready slugs fall
  //    through to the Supervisor default below (the dashboard surfaces the
  //    instance's real state instead of the router emitting a bare 404/503).
  const segment = firstSegment(pathname);
  if (segment !== "" && !isReserved(segment) && isValidSlug(segment)) {
    const entry = allowlist.lookup(segment);
    if (entry) {
      const authority = upstreamAuthority(entry);

      // The terminal WebSocket: exactly `/<slug>/ws` AND a real upgrade →
      // proxy the upgrade to the instance's ws port. Path forwarded UNCHANGED
      // so the instance's `WS_PATH_PREFIX` (`/<slug>/ws`) gate matches.
      if (isUpgrade && pathname === `/${segment}/ws`) {
        return {
          kind: "proxy-ws",
          upstreamWsBase: `ws://${authority}:${entry.wsPort}`,
          path: pathname,
          slug: segment,
        };
      }

      // Everything else under `/<slug>` → HTTP proxy to the instance's http
      // port, path + query forwarded UNCHANGED (caller re-appends the query).
      return {
        kind: "proxy-http",
        upstreamBase: `http://${authority}:${entry.httpPort}`,
        path: pathname,
        slug: segment,
      };
    }
  }

  // 4. Default: the Supervisor dashboard. Root `/`, reserved segments
  //    (`api`, `_next`, `login`, `icons`, …), valid-but-not-ready slugs, and
  //    malformed segments all proxy to the Supervisor on the SAME host with NO
  //    path stripping (it serves at root). A WS upgrade goes to the
  //    Supervisor's ws base; everything else to its http base.
  if (isUpgrade) {
    return {
      kind: "proxy-ws",
      upstreamWsBase: supervisor.wsBase,
      path: pathname,
      slug: "",
    };
  }
  return {
    kind: "proxy-http",
    upstreamBase: supervisor.httpBase,
    path: pathname,
    slug: "",
  };
}
