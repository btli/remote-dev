import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/ccflare/keys/active");

/**
 * GET /api/ccflare/keys/active?sessionId=xxx
 *
 * Retrieves the active ANTHROPIC_API_KEY for a session from the terminal server's
 * in-memory proxy state. Used to prefill the add-key form.
 */
export const GET = withAuth(async (request) => {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");

    if (!sessionId) {
      return errorResponse("Missing sessionId", 400, "SESSION_ID_REQUIRED");
    }

    // Fetch from terminal server's in-memory store
    const terminalPort = process.env.TERMINAL_PORT || "6002";
    const resp = await fetch(
      `http://127.0.0.1:${terminalPort}/internal/proxy-state/key?sessionId=${encodeURIComponent(sessionId)}`,
      { signal: AbortSignal.timeout(3000) }
    );

    if (!resp.ok) {
      return errorResponse("Failed to fetch active key", 502);
    }

    const data = await resp.json();
    return NextResponse.json({
      apiKey: data.apiKey ?? null,
      baseUrl: data.baseUrl ?? null,
      keyPrefix: data.keyPrefix ?? null,
    });
  } catch (error) {
    log.error("Failed to fetch active proxy key", { error: String(error) });
    return errorResponse("Failed to fetch active key", 500);
  }
});
