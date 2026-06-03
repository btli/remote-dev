import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { getPortsForUser } from "@/services/port-registry-service";
import { checkPorts } from "@/services/port-monitoring-service";
import { getActiveClaimsForUser } from "@/services/port-claims-service";
import { ProjectService } from "@/services/project-service";
import { listSessions } from "@/services/session-service";
import type { PortAllocationWithFolder, PortStatus } from "@/types/port";
import type { PortClaim } from "@/services/port-claims-service";

/**
 * GET /api/ports
 *
 * Returns all port allocations for the current user with project (folder)
 * names and *real* live status. We run a SINGLE lsof scan over the allocated
 * ports (no per-port N+1) and merge the user's active runtime claims so each
 * allocation reports its true `isActive`/`isListening`, plus `pid`/`process`
 * from the scan and `sessionId`/`sessionName` from a matching claim.
 */
export const GET = withAuth(async (_request, { userId }) => {
  const [ports, projects] = await Promise.all([
    getPortsForUser(userId),
    ProjectService.listByUser(userId),
  ]);

  // Build project (folder) name lookup.
  const folderNames = new Map<string, string>();
  for (const project of projects) {
    folderNames.set(project.id, project.name);
  }

  // One scan over the allocated ports + the user's claims + sessions, all in
  // parallel. checkPorts internally does a single lsof of every listening port.
  const allocatedPorts = ports.map((p) => p.port);
  const [statuses, claims, sessions] = await Promise.all([
    checkPorts(allocatedPorts),
    getActiveClaimsForUser(userId),
    listSessions(userId),
  ]);

  const statusByPort = new Map<number, PortStatus>(
    statuses.map((s) => [s.port, s]),
  );
  // A port may be claimed by more than one session; keep the first claim per
  // port (claims for the same port are functionally interchangeable here).
  const claimByPort = new Map<number, PortClaim>();
  for (const claim of claims) {
    if (!claimByPort.has(claim.port)) claimByPort.set(claim.port, claim);
  }
  const sessionNameById = new Map<string, string>(
    sessions.map((s) => [s.id, s.name]),
  );

  const allocations: PortAllocationWithFolder[] = ports.map((port) => {
    const status = statusByPort.get(port.port);
    const claim = claimByPort.get(port.port);
    const isListening = status?.isListening ?? false;

    return {
      id: port.id,
      port: port.port,
      variableName: port.variableName,
      folderId: port.projectId ?? "",
      folderName: port.projectId
        ? folderNames.get(port.projectId) || "Unknown"
        : "Unknown",
      isActive: isListening,
      isListening,
      pid: status?.pid ?? null,
      process: status?.process ?? null,
      sessionId: claim?.sessionId ?? null,
      sessionName: claim
        ? sessionNameById.get(claim.sessionId) ?? null
        : null,
      createdAt: port.createdAt,
    };
  });

  return NextResponse.json({ allocations });
});
