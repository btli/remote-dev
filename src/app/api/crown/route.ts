/**
 * /api/crown (epic remote-dev-oyej.5)
 *   GET  — list the caller's Crown runs.
 *   POST — start a Crown run (async; returns the crownRunId immediately).
 */
import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as CrownService from "@/services/crown-service";
import { AGENT_PROVIDERS } from "@/types/session";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/crown");

const VALID_PROVIDERS = new Set(AGENT_PROVIDERS.map((p) => p.id));

interface StartCrownBody {
  projectId?: string;
  prompt?: string;
  count?: number;
  agentProvider?: string;
  judgeModel?: string;
  baseBranch?: string | null;
  timeoutMs?: number;
}

export const GET = withApiAuth(async (_request, { userId }) => {
  try {
    const runs = await CrownService.listCrowns(userId);
    return NextResponse.json({ runs });
  } catch (error) {
    log.error("Error listing crown runs", { error: String(error) });
    return errorResponse("Failed to list crown runs", 500);
  }
});

export const POST = withApiAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<StartCrownBody>(request);
    if ("error" in result) return result.error;
    const body = result.data;

    if (!body.projectId) {
      return errorResponse("projectId is required", 400, "PROJECT_ID_REQUIRED");
    }
    if (!body.prompt || body.prompt.trim() === "") {
      return errorResponse("prompt is required", 400, "PROMPT_REQUIRED");
    }
    const count = body.count ?? 2;
    if (!Number.isInteger(count) || count < 1 || count > 10) {
      return errorResponse("count must be 1–10", 400, "INVALID_COUNT");
    }
    const agentProvider = body.agentProvider ?? "claude";
    if (!VALID_PROVIDERS.has(agentProvider as never)) {
      return errorResponse(
        `Unknown agent provider "${agentProvider}"`,
        400,
        "INVALID_PROVIDER",
      );
    }

    const input = {
      projectId: body.projectId,
      prompt: body.prompt,
      count,
      agentProvider,
      judgeModel: body.judgeModel,
      baseBranch: body.baseBranch ?? null,
      timeoutMs: body.timeoutMs,
    };

    // Insert the run first to get a deterministic id, then run the (slow)
    // fan-out detached so the client gets a 202 immediately and polls
    // GET /api/crown/:id.
    const run = await CrownService.beginCrown(input, userId);
    void CrownService.runCrownOrchestration(run, input, userId).catch((err) =>
      log.error("crown run failed", { crownRunId: run.id, error: String(err) }),
    );

    return NextResponse.json(
      { crownRunId: run.id, status: run.status },
      { status: 202 },
    );
  } catch (error) {
    log.error("Error starting crown run", { error: String(error) });
    return errorResponse("Failed to start crown run", 500);
  }
});
