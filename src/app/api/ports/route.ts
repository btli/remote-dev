import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { getPortsForUser } from "@/services/port-registry-service";
import { getFolders } from "@/services/folder-service";

/**
 * GET /api/ports
 * Returns all port allocations for the current user with folder names
 */
export const GET = withAuth(async (_request, { userId }) => {
  const [ports, folders] = await Promise.all([
    getPortsForUser(userId),
    getFolders(userId),
  ]);

  // Build folder name lookup
  const folderNames = new Map<string, string>();
  for (const folder of folders) {
    folderNames.set(folder.id, folder.name);
  }

  // Transform ports to include folder names and active status
  const allocations = ports.map((port) => ({
    id: port.id,
    port: port.port,
    variableName: port.variableName,
    folderId: port.folderId,
    folderName: folderNames.get(port.folderId) || "Unknown",
    isActive: false, // Will be updated by status check
    createdAt: port.createdAt,
  }));

  return NextResponse.json({ allocations });
});
