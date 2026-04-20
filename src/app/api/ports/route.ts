import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { getPortsForUser } from "@/services/port-registry-service";
import { ProjectService } from "@/services/project-service";

/**
 * GET /api/ports
 * Returns all port allocations for the current user with project (folder) names
 */
export const GET = withAuth(async (_request, { userId }) => {
  const [ports, projects] = await Promise.all([
    getPortsForUser(userId),
    ProjectService.listByUser(userId),
  ]);

  // Build project (folder) name lookup
  const folderNames = new Map<string, string>();
  for (const project of projects) {
    folderNames.set(project.id, project.name);
  }

  // Transform ports to include folder names and active status
  const allocations = ports.map((port) => ({
    id: port.id,
    port: port.port,
    variableName: port.variableName,
    folderId: port.projectId,
    folderName: port.projectId
      ? folderNames.get(port.projectId) || "Unknown"
      : "Unknown",
    isActive: false, // Will be updated by status check
    createdAt: port.createdAt,
  }));

  return NextResponse.json({ allocations });
});
