import { isLocalhostRequest } from "@/lib/auth-utils";
import { proxyToRdvServerNoAuth } from "@/lib/rdv-proxy";
import { NextResponse } from "next/server";

/**
 * GET /api/orchestrators/agent-event
 *
 * Health check endpoint for hooks to verify connectivity.
 * Restricted to localhost only for security.
 *
 * Proxies to rdv-server.
 */
export async function GET(request: Request) {
  // Security: Only allow requests from localhost
  const isLocalhost = await isLocalhostRequest();
  if (!isLocalhost) {
    return NextResponse.json(
      { error: "Access denied - localhost only" },
      { status: 403 }
    );
  }

  return proxyToRdvServerNoAuth(request, {
    path: "/orchestrators/agent-event",
  });
}

/**
 * POST /api/orchestrators/agent-event
 *
 * Receives lifecycle events from agent hooks.
 * This is the primary communication channel from agents to the orchestrator.
 *
 * Restricted to localhost only for security - hooks run in trusted local environment.
 *
 * Proxies to rdv-server.
 */
export async function POST(request: Request) {
  // Security: Only allow requests from localhost
  const isLocalhost = await isLocalhostRequest();
  if (!isLocalhost) {
    return NextResponse.json(
      { error: "Access denied - localhost only" },
      { status: 403 }
    );
  }

  return proxyToRdvServerNoAuth(request, {
    path: "/orchestrators/agent-event",
  });
}
