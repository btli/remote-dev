/**
 * Pure routing decision for the Supervisor router (spec §5, §15 B2/M4/M5).
 *
 * Given a request's pathname, whether it's a WebSocket upgrade, and an allowlist
 * lookup, this returns a typed decision. It performs NO I/O — that makes it the
 * unit-testable core. `index.ts` executes the decision (HTTP proxy / WS upgrade /
 * direct response).
 *
 * Routing is convention-based with NO prefix stripping: the instance image is
 * slug-aware and genuinely serves under `/<slug>`, so the router forwards the
 * full path (and query) UNCHANGED.
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
  | { kind: "landing" }
  | { kind: "not-found" }
  | {
      kind: "proxy-http";
      /** e.g. `http://rdv.rdv-alpha.svc.cluster.local:6001` (no trailing slash). */
      upstreamBase: string;
      /** The path to forward UNCHANGED (no query — caller appends search). */
      path: string;
      slug: string;
    }
  | {
      kind: "proxy-ws";
      /** e.g. `ws://rdv.rdv-alpha.svc.cluster.local:6002` (no trailing slash). */
      upstreamWsBase: string;
      /** The path to forward UNCHANGED. */
      path: string;
      slug: string;
    };

/** Router liveness path — answered locally, never proxied (§5). */
export const HEALTH_PATH = "/healthz";

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
 * @param pathname  URL pathname (no query string), e.g. `/alpha/api/foo`.
 * @param isUpgrade whether this is a WebSocket upgrade request.
 * @param allowlist last-known-good ready-instance lookup.
 */
export function decideRoute(
  pathname: string,
  isUpgrade: boolean,
  allowlist: AllowlistLookup,
): RouteDecision {
  // 1. Router liveness — answered locally (checked before the reserved-slug
  //    rule, even though "healthz" is also a reserved slug).
  if (pathname === HEALTH_PATH) {
    return { kind: "health" };
  }

  const segment = firstSegment(pathname);

  // 2. Root path or empty first segment → landing/instance-picker.
  if (segment === "") {
    return { kind: "landing" };
  }

  // 3. Reserved first segment (api, _next, login, icons, …) → landing, never
  //    proxied. Checked BEFORE the format rule because some reserved names
  //    (e.g. `_next`, `manifest.json`) don't even satisfy the slug grammar — a
  //    reserved segment should still surface the picker, not a 404. The
  //    Supervisor UI lives on its own hostname (§15 M3); the router only
  //    surfaces a minimal picker here.
  if (isReserved(segment)) {
    return { kind: "landing" };
  }

  // 4. Malformed slug (fails the validator for any other reason) → 404.
  if (!isValidSlug(segment)) {
    return { kind: "not-found" };
  }

  // 5. Valid slug but not a known ready instance → 404. The allowlist only
  //    contains ready instances, so "unknown" and "not-ready" collapse to 404
  //    here; a separately-tracked not-ready state would 503 (see §5/§15 M4).
  const entry = allowlist.lookup(segment);
  if (!entry) {
    return { kind: "not-found" };
  }

  const authority = upstreamAuthority(entry);

  // 6. The terminal WebSocket: exactly `/<slug>/ws` AND a real upgrade → proxy
  //    the upgrade to the instance's ws port. Path forwarded UNCHANGED so the
  //    instance's `WS_PATH_PREFIX` (`/<slug>/ws`) gate matches.
  if (isUpgrade && pathname === `/${segment}/ws`) {
    return {
      kind: "proxy-ws",
      upstreamWsBase: `ws://${authority}:${entry.wsPort}`,
      path: pathname,
      slug: segment,
    };
  }

  // 7. Everything else under `/<slug>` → HTTP proxy to the instance's http port,
  //    path + query forwarded UNCHANGED (caller re-appends the query string).
  return {
    kind: "proxy-http",
    upstreamBase: `http://${authority}:${entry.httpPort}`,
    path: pathname,
    slug: segment,
  };
}
