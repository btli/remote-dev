/**
 * Log Stream API - Server-Sent Events endpoint for real-time log streaming
 *
 * GET /api/logs/stream?sessionId=xxx
 *
 * Streams execution logs in real-time for a specific session or all sessions.
 * Proxies to rdv-server SSE endpoint at /logs/stream.
 */

import { auth } from "@/auth";
import { streamSseFromRdvServer } from "@/lib/rdv-proxy";

export async function GET(request: Request) {
  // Authenticate
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;

  // Forward query string to rdv-server
  const { searchParams } = new URL(request.url);
  const queryString = searchParams.toString();
  const path = `/logs/stream${queryString ? `?${queryString}` : ""}`;

  // Stream SSE from rdv-server
  return streamSseFromRdvServer(userId, path);
}
