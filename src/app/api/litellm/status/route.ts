import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { resolveTerminalServerUrl } from "@/lib/terminal-server-url";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/litellm/status");

/**
 * GET /api/litellm/status - Get LiteLLM proxy status
 *
 * Proxies to the terminal server where the process manager tracks the running state.
 */
export const GET = withAuth(async (_request, { userId: _userId }) => {
  try {
    const baseUrl = resolveTerminalServerUrl();
    const resp = await fetch(`${baseUrl}/internal/litellm/status`, {
      method: "GET",
    });

    const text = await resp.text();
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text);
    } catch {
      log.warn("Non-JSON response from terminal server", { status: resp.status, body: text.slice(0, 100) });
      // Terminal server returned non-JSON (e.g. "WebSocket endpoint only")
      return NextResponse.json({
        installed: false,
        running: false,
        port: null,
        pid: null,
        version: null,
        uptime: null,
      });
    }

    if (!resp.ok) {
      return errorResponse(
        (data.error as string) ?? "Failed to get LiteLLM status",
        resp.status
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    log.error("Failed to get LiteLLM status", { error: String(error) });
    // If the terminal server is unreachable, return a safe default
    return NextResponse.json({
      installed: false,
      running: false,
      port: null,
      pid: null,
      version: null,
      uptime: null,
    });
  }
});
