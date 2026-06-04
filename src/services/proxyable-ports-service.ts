/**
 * Runtime port-membership: the authoritative `(listening ∪ active claims)` set a
 * user may proxy to (remote-dev-urjg).
 *
 * `isPortProxyable` (in `@/lib/proxy-port-utils`) is only the cheap SYNTACTIC
 * gate (blocks <1024 + the hard-blocked instance ports). On its own it would let
 * the proxy reach ANY of ~64k loopback ports. This module adds the second gate:
 * the port must be in the user's live universe — currently listening on the
 * instance, OR claimed by one of the user's running sessions (union semantics, so
 * a just-claimed port that hasn't been observed listening yet is still allowed).
 *
 * Both the HTTP proxy route (`src/app/proxy/[port]/[...path]`) and the WS bridge
 * (`src/server/proxy-ws-bridge.ts`) call this directly — no internal HTTP round
 * trip. `GET /api/ports/proxyable` reuses {@link loadProxyableContext} too, so
 * the route's response and these gates derive from the EXACT same union+filter.
 *
 * Scoping note (matches `/api/ports/proxyable`): listening ports are process-
 * global on a single instance, not per-user. Under the owner-scoped model the
 * whole instance belongs to ONE user, so instance-wide listening ports are
 * legitimately in that user's scope. Claims are filtered to the user.
 */

import { getListeningPorts } from "@/services/port-monitoring-service";
import {
  getActiveClaimsForUser,
  type PortClaim,
} from "@/services/port-claims-service";
import { isPortProxyable } from "@/lib/proxy-port-utils";

/** Listening-port scan result keyed by port (process/pid optional). */
export type ListeningPorts = Map<number, { process?: string; pid?: number }>;

/**
 * The raw inputs to the proxyable-set computation, fetched once. Exposed so the
 * `/api/ports/proxyable` route can build its richer per-port response from the
 * SAME data this module filters, without re-querying.
 */
export interface ProxyableContext {
  listening: ListeningPorts;
  claims: PortClaim[];
}

/**
 * Pure: build the set of proxyable ports from already-fetched inputs.
 *
 * A port is included iff it is listening OR claimed AND it passes the syntactic
 * {@link isPortProxyable} gate (drops privileged <1024 and hard-blocked
 * 6001/6002 ports).
 */
export function computeProxyablePortSet(
  listening: ListeningPorts,
  claims: PortClaim[],
): Set<number> {
  const set = new Set<number>();
  for (const port of listening.keys()) {
    if (isPortProxyable(port)) set.add(port);
  }
  for (const claim of claims) {
    if (isPortProxyable(claim.port)) set.add(claim.port);
  }
  return set;
}

/**
 * Fetch the listening ports + the user's active claims in parallel.
 *
 * Shared by {@link getProxyablePortSet} and the `/api/ports/proxyable` route.
 */
export async function loadProxyableContext(
  userId: string,
): Promise<ProxyableContext> {
  const [listening, claims] = await Promise.all([
    getListeningPorts(),
    getActiveClaimsForUser(userId),
  ]);
  return { listening, claims };
}

/**
 * The authoritative set of ports `userId` may proxy to right now
 * (`(listening ∪ active claims)` filtered by {@link isPortProxyable}).
 */
export async function getProxyablePortSet(
  userId: string,
): Promise<Set<number>> {
  const { listening, claims } = await loadProxyableContext(userId);
  return computeProxyablePortSet(listening, claims);
}

/**
 * Runtime membership check for a single port — the second gate the proxy enforces
 * after `isPortProxyable`.
 *
 * @returns true iff `port` is in `userId`'s `(listening ∪ claimed)` proxyable set.
 */
export async function isPortProxyableForUser(
  userId: string,
  port: number,
): Promise<boolean> {
  // Cheap syntactic gate first — avoids a DB/`lsof` round trip for obviously
  // illegal ports (privileged, hard-blocked, out of range).
  if (!isPortProxyable(port)) return false;
  const set = await getProxyablePortSet(userId);
  return set.has(port);
}
