/**
 * SSE endpoint for real-time session updates
 *
 * This endpoint streams session events (created, updated, deleted) to connected clients.
 * Uses the rdv-proxy to forward SSE stream from rdv-server via Unix socket.
 *
 * Events are filtered server-side so clients only receive events for their own sessions.
 *
 * Event format:
 * ```
 * event: session
 * data: {"type":"created","user_id":"...","session_id":"...","session":{...},"timestamp":...}
 * ```
 */

import { streamSseFromRdvServer } from "@/lib/rdv-proxy";
import { getAuthSession } from "@/lib/auth-utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  // Check authentication
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Stream SSE from rdv-server
  return streamSseFromRdvServer(session.user.id, "/events/sessions");
}
