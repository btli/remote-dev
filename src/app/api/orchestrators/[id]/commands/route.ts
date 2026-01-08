import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { checkRateLimit, createRateLimitHeaders } from "@/lib/rate-limit";
import * as OrchestratorService from "@/services/orchestrator-service";
import * as SessionService from "@/services/session-service";
import { injectCommandUseCase } from "@/infrastructure/container";

/**
 * POST /api/orchestrators/[id]/commands - Inject command to a session
 *
 * Allows the orchestrator to send commands to monitored sessions.
 * Includes safety validation and audit logging.
 * Rate limit: 20 requests per minute (strict limit for command execution)
 */
export const POST = withAuth(async (request, { userId, params }) => {
    // Strict rate limit for command injection (20 per minute)
    const rateLimit = checkRateLimit(`orchestrators:commands:${userId}`, {
      limit: 20,
      windowMs: 60 * 1000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Too many command injections." },
        {
          status: 429,
          headers: createRateLimitHeaders(rateLimit),
        }
      );
    }
    try {
      // Verify orchestrator exists and belongs to user
      const orchestrator = await OrchestratorService.getOrchestrator(
        params!.id,
        userId
      );

      if (!orchestrator) {
        return errorResponse("Orchestrator not found", 404, "ORCHESTRATOR_NOT_FOUND");
      }

      // Parse request body
      const result = await parseJsonBody<{
        sessionId: string;
        command: string;
        reason?: string;
        pressEnter?: boolean;
      }>(request);
      if ("error" in result) return result.error;
      const body = result.data;

      // Validate required fields
      if (!body.sessionId) {
        return errorResponse("sessionId is required", 400, "MISSING_SESSION_ID");
      }

      if (!body.command) {
        return errorResponse("command is required", 400, "MISSING_COMMAND");
      }

      // Get session details
      const session = await SessionService.getSession(body.sessionId, userId);

      if (!session) {
        return errorResponse("Session not found", 404, "SESSION_NOT_FOUND");
      }

      if (session.status === "closed") {
        return errorResponse(
          "Cannot inject command to closed session",
          400,
          "SESSION_CLOSED"
        );
      }

      // Execute command injection use case
      try {
        const commandResult = await injectCommandUseCase.execute({
          orchestratorId: params!.id,
          targetSessionId: body.sessionId,
          targetTmuxSessionName: session.tmuxSessionName,
          targetSessionFolderId: session.folderId,
          command: body.command,
          pressEnter: body.pressEnter,
          reason: body.reason,
        });

        return NextResponse.json({
          success: commandResult.result.success,
          sessionId: body.sessionId,
          command: body.command,
          timestamp: commandResult.result.timestamp,
          auditLogId: commandResult.auditLog.id,
          error: commandResult.result.error,
        });
      } catch (useCaseError) {
        // Handle domain errors from use case
        const message =
          useCaseError instanceof Error ? useCaseError.message : String(useCaseError);
        const code =
          useCaseError instanceof Error && "code" in useCaseError
            ? (useCaseError as { code: string }).code
            : "COMMAND_INJECTION_FAILED";

        return errorResponse(message, 400, code);
      }
    } catch (error) {
      console.error("Error injecting command:", error);

      if (error instanceof OrchestratorService.OrchestratorServiceError) {
        return errorResponse(error.message, 400, error.code);
      }

      return errorResponse("Failed to inject command", 500);
    }
});
