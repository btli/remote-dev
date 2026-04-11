import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { resolveTerminalServerUrl } from "@/lib/terminal-server-url";
import { createLogger } from "@/lib/logger";

import type { LiteLLMControlAction } from "@/types/litellm";

const log = createLogger("api/litellm/control");

const VALID_ACTIONS: LiteLLMControlAction[] = ["start", "stop", "restart"];

/**
 * POST /api/litellm/control - Start, stop, or restart LiteLLM proxy
 *
 * Proxies the control action to the terminal server where the process manager lives.
 * Body: { action: "start" | "stop" | "restart" }
 */
export const POST = withAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<{ action: LiteLLMControlAction }>(
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

    const baseUrl = resolveTerminalServerUrl();

    if (action === "start") {
      const resp = await fetch(`${baseUrl}/internal/litellm/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        return errorResponse(
          data.error ?? "Failed to start LiteLLM",
          resp.status
        );
      }
      log.info("LiteLLM started", { userId });
      return NextResponse.json(data);
    }

    if (action === "stop") {
      const resp = await fetch(`${baseUrl}/internal/litellm/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await resp.json();
      if (!resp.ok) {
        return errorResponse(
          data.error ?? "Failed to stop LiteLLM",
          resp.status
        );
      }
      log.info("LiteLLM stopped", { userId });
      return NextResponse.json(data);
    }

    // restart
    const resp = await fetch(`${baseUrl}/internal/litellm/restart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      return errorResponse(
        data.error ?? "Failed to restart LiteLLM",
        resp.status
      );
    }
    log.info("LiteLLM restarted", { userId });
    return NextResponse.json(data);
  } catch (error) {
    log.error("Failed to control LiteLLM", { error: String(error) });
    return errorResponse("Failed to control LiteLLM proxy", 500);
  }
});
