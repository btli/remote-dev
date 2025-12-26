import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { checkPorts } from "@/services/port-monitoring-service";

/**
 * POST /api/ports/status
 * Check which ports from the provided list are currently listening
 *
 * Body: { ports: number[] }
 * Returns: { ports: PortStatus[], checkedAt: string }
 */
export const POST = withAuth(async (request) => {
  const body = await request.json();
  const { ports } = body;

  if (!Array.isArray(ports)) {
    return errorResponse("ports must be an array of numbers", 400);
  }

  // Validate all ports are numbers
  const validPorts = ports.filter(
    (p) => typeof p === "number" && p >= 1 && p <= 65535
  );

  if (validPorts.length === 0) {
    return NextResponse.json({
      ports: [],
      checkedAt: new Date().toISOString(),
    });
  }

  const statuses = await checkPorts(validPorts);

  return NextResponse.json({
    ports: statuses,
    checkedAt: new Date().toISOString(),
  });
});
