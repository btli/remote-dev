/**
 * /api/agent-runs (epic remote-dev-oyej.1/.4)
 *   GET  — list the caller's runs (filter by scheduleId/triggerConfigId/status).
 *   POST — manual immediate launch: a REAL agent run (source:"manual").
 *
 * This is also the endpoint the supervisor agent-launch / delegation APIs
 * (oyej.10/.11) proxy into on a target instance.
 */
import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as AgentRunService from "@/services/agent-run-service";
import type { AgentRunRow } from "@/services/agent-run-service";
import { AGENT_PROVIDERS } from "@/types/session";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/agent-runs");

const VALID_PROVIDERS = new Set(AGENT_PROVIDERS.map((p) => p.id));

interface ManualRunBody {
  projectId?: string;
  prompt?: string;
  agentProvider?: string;
  agentFlags?: string[];
  worktreeType?: string | null;
  baseBranch?: string | null;
  source?: string;
}

export const GET = withApiAuth(async (request, { userId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const runs = await AgentRunService.listRuns(userId, {
      scheduleId: searchParams.get("scheduleId") ?? undefined,
      triggerConfigId: searchParams.get("triggerConfigId") ?? undefined,
      status: (searchParams.get("status") as AgentRunRow["status"]) ?? undefined,
    });
    return NextResponse.json({ runs });
  } catch (error) {
    log.error("Error listing agent runs", { error: String(error) });
    return errorResponse("Failed to list agent runs", 500);
  }
});

export const POST = withApiAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<ManualRunBody>(request);
    if ("error" in result) return result.error;
    const body = result.data;

    if (!body.projectId) {
      return errorResponse("projectId is required", 400, "PROJECT_ID_REQUIRED");
    }
    if (!body.prompt || body.prompt.trim() === "") {
      return errorResponse("prompt is required", 400, "PROMPT_REQUIRED");
    }
    const agentProvider = body.agentProvider || "claude";
    if (!VALID_PROVIDERS.has(agentProvider as never)) {
      return errorResponse(
        `Unknown agent provider "${agentProvider}"`,
        400,
        "INVALID_PROVIDER",
      );
    }

    const run = await AgentRunService.launchAgentRun({
      userId,
      projectId: body.projectId,
      source: "manual",
      agentProvider,
      agentFlags: body.agentFlags ?? [],
      prompt: body.prompt,
      worktreeType: body.worktreeType ?? null,
      baseBranch: body.baseBranch ?? null,
    });

    return NextResponse.json(run, { status: 202 });
  } catch (error) {
    log.error("Error launching manual agent run", { error: String(error) });
    return errorResponse("Failed to launch agent run", 500);
  }
});
