import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { resolveTerminalServerUrl } from "@/lib/terminal-server-url";
import * as CcflareService from "@/services/ccflare-service";
import { createLogger } from "@/lib/logger";

import type { CcflareControlAction } from "@/types/ccflare";

const log = createLogger("api/ccflare/control");

const VALID_ACTIONS: CcflareControlAction[] = ["start", "stop", "restart"];

/**
 * POST /api/ccflare/control - Start, stop, or restart ccflare proxy
 *
 * Proxies the control action to the terminal server where the process manager lives.
 * Body: { action: "start" | "stop" | "restart" }
 */
export const POST = withAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<{ action: CcflareControlAction }>(
      request
    );
    if ("error" in result) return result.error;
    const { action } = result.data;

    if (!action || !VALID_ACTIONS.includes(action)) {
      return errorResponse(
        `Invalid action. Must be one of: ${VALID_ACTIONS.join(", ")}`,
        400,
        "INVALID_ACTION"
      );
    }

    // For start/restart, get the user's configured port
    let port: number | undefined;
    if (action === "start" || action === "restart") {
      const config = await CcflareService.getConfig(userId);
      port = config?.port ?? 8787;
    }

    const baseUrl = resolveTerminalServerUrl();

    if (action === "start") {
      const resp = await fetch(`${baseUrl}/internal/ccflare/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        return errorResponse(
          data.error ?? "Failed to start ccflare",
          resp.status
        );
      }
      log.info("ccflare started", { userId, port });
      return NextResponse.json(data);
    }

    if (action === "stop") {
      const resp = await fetch(`${baseUrl}/internal/ccflare/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await resp.json();
      if (!resp.ok) {
        return errorResponse(
          data.error ?? "Failed to stop ccflare",
          resp.status
        );
      }
      log.info("ccflare stopped", { userId });
      return NextResponse.json(data);
    }

    // restart
    const resp = await fetch(`${baseUrl}/internal/ccflare/restart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ port }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      return errorResponse(
        data.error ?? "Failed to restart ccflare",
        resp.status
      );
    }
    log.info("ccflare restarted", { userId, port });
    return NextResponse.json(data);
  } catch (error) {
    log.error("Failed to control ccflare", { error: String(error) });
    return errorResponse("Failed to control ccflare proxy", 500);
  }
});
