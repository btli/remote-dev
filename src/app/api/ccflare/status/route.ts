import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { resolveTerminalServerUrl } from "@/lib/terminal-server-url";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/ccflare/status");

/**
 * GET /api/ccflare/status - Get ccflare proxy status
 *
 * Proxies to the terminal server where the process manager tracks the running state.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const GET = withAuth(async (_request, { userId: _userId }) => {
  try {
    const baseUrl = resolveTerminalServerUrl();
    const resp = await fetch(`${baseUrl}/internal/ccflare/status`, {
      method: "GET",
    });
    const data = await resp.json();

    if (!resp.ok) {
      return errorResponse(
        data.error ?? "Failed to get ccflare status",
        resp.status
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    log.error("Failed to get ccflare status", { error: String(error) });
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
