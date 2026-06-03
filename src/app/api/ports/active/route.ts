import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { portMonitor } from "@/infrastructure/container";
import type { ActivePortsResponse } from "@/types/port";

/**
 * GET /api/ports/active
 *
 * Additive runtime discovery: scans the environment of the user's active tmux
 * sessions for port-like variables. This catches ports that are NOT in the
 * declarative port registry (e.g. a dev server an agent started ad hoc).
 *
 * Returns: { activePorts: ActivePortInfo[] }
 */
export const GET = withAuth(async (_request, { userId }) => {
  const activePorts = await portMonitor.getActivePorts(userId);

  const body: ActivePortsResponse = { activePorts };
  return NextResponse.json(body);
});
