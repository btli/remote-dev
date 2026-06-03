import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api";
import { getListeningPorts } from "@/services/port-monitoring-service";
import { getActiveClaimsForUser } from "@/services/port-claims-service";
import { listSessions } from "@/services/session-service";
import { isPortProxyable } from "@/lib/proxy-port-utils";
import type { ProxyablePort, ProxyablePortsResponse } from "@/types/port";

/**
 * GET /api/ports/proxyable — THE SEAM consumed by Track B.
 *
 * Dual-auth (session OR Bearer API key) because agents/CLI call it. Returns the
 * set of ports that may be proxied for this user, sorted by port ascending.
 *
 * The proxyable universe is `(listening ∪ active claims)` minus anything that
 * fails `isPortProxyable` (drops privileged < 1024 and the hard-blocked
 * 6001/6002 instance ports).
 *
 * Scoping rationale: listening ports are process-global on a single instance,
 * not per-user. Per the owner-scoped model the whole instance belongs to ONE
 * user, so instance-wide listening ports are legitimately in this user's scope.
 * We cross-reference each listening port with the user's claims to attach
 * `sessionId`/`sessionName`/`projectId`/`variableName` when known.
 *
 * sessionName join: claims carry `sessionId` but not the name, so we fetch the
 * user's sessions ONCE and build a `Map<sessionId, name>` (no per-port N+1). If
 * a claim's session can't be resolved, `sessionName` is null.
 */
export const GET = withApiAuth(async (_request, { userId }) => {
  const [listening, claims, sessions] = await Promise.all([
    getListeningPorts(),
    getActiveClaimsForUser(userId),
    listSessions(userId),
  ]);

  const sessionNameById = new Map<string, string>(
    sessions.map((s) => [s.id, s.name]),
  );

  // First claim per port wins (claims for the same port are interchangeable for
  // the proxy's purposes — they all point at the same listener).
  const claimByPort = new Map<number, (typeof claims)[number]>();
  for (const claim of claims) {
    if (!claimByPort.has(claim.port)) claimByPort.set(claim.port, claim);
  }

  // Union of listening + claimed ports, filtered by the syntactic allowlist.
  const candidatePorts = new Set<number>();
  for (const port of listening.keys()) {
    if (isPortProxyable(port)) candidatePorts.add(port);
  }
  for (const port of claimByPort.keys()) {
    if (isPortProxyable(port)) candidatePorts.add(port);
  }

  const ports: ProxyablePort[] = [];
  for (const port of candidatePorts) {
    const live = listening.get(port);
    const isListening = live !== undefined;
    const claim = claimByPort.get(port);

    const source: ProxyablePort["source"] = isListening
      ? claim
        ? "both"
        : "listening"
      : "claim";

    ports.push({
      port,
      isListening,
      pid: live?.pid ?? claim?.pid ?? null,
      process: live?.process ?? null,
      sessionId: claim?.sessionId ?? null,
      sessionName: claim
        ? sessionNameById.get(claim.sessionId) ?? null
        : null,
      projectId: claim?.projectId ?? null,
      variableName: claim?.variableName ?? null,
      source,
    });
  }

  ports.sort((a, b) => a.port - b.port);

  const body: ProxyablePortsResponse = { ports };
  return NextResponse.json(body);
});
