import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { validateProjectPath } from "@/lib/api-validation";
import * as SessionService from "@/services/session-service";
import type { CreateSessionInput, SessionStatus } from "@/types/session";
import { WORKTREE_TYPES } from "@/types/session";
import { broadcastSidebarChanged } from "@/lib/broadcast";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/sessions");

/**
 * GET /api/sessions - List user's terminal sessions
 *
 * Supports both session auth and API key auth for agent access.
 * Query params:
 *   - status: comma-separated list of statuses to filter by
 *   - parentSessionId: filter sessions by parent session ID (for team orchestration)
 */
export const GET = withApiAuth(async (request, { userId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get("status");
    const parentSessionId = searchParams.get("parentSessionId");
    const statuses = statusParam
      ? statusParam
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [];
    const status = statuses.length > 1
      ? (statuses as SessionStatus[])
      : (statuses[0] as SessionStatus | undefined);

    const sessions = await SessionService.listSessions(
      userId,
      status ?? undefined,
      parentSessionId ?? undefined
    );

    return NextResponse.json({ sessions });
  } catch (error) {
    log.error("Error listing sessions", { error: String(error) });
    return errorResponse("Failed to list sessions", 500);
  }
});

/**
 * POST /api/sessions - Create a new terminal session
 *
 * Supports both session auth and API key auth for agent access.
 * Agents can create sessions with worktrees for issue workflows.
 */
export const POST = withApiAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<{
      name?: string;
      projectPath?: string;
      githubRepoId?: string;
      worktreeBranch?: string;
      folderId?: string;
      projectId?: string;
      startupCommand?: string;
      featureDescription?: string;
      createWorktree?: boolean;
      baseBranch?: string;
      worktreeType?: string;
      terminalType?: "shell" | "agent" | "file" | "browser" | "loop";
      filePath?: string;
      profileId?: string;
      agentProvider?: string;
      autoLaunchAgent?: boolean;
      agentFlags?: string[];
      parentSessionId?: string;
      loopConfig?: { loopType?: string; intervalSeconds?: number; promptTemplate?: string; maxIterations?: number; autoRestart?: boolean };
      scopeKey?: string | null;
      typeMetadata?: Record<string, unknown>;
    }>(request);
    if ("error" in result) return result.error;
    const body = result.data;

    // Phase G0a: terminal_session.project_id is NOT NULL. Require a project.
    // Accept legacy `folderId` as an alias during the rename migration window.
    const resolvedProjectId = body.projectId ?? body.folderId;
    if (!resolvedProjectId || typeof resolvedProjectId !== "string") {
      return errorResponse(
        "projectId is required to create a session",
        400,
        "PROJECT_ID_REQUIRED"
      );
    }

    // Validate worktreeType against allowlist
    if (body.worktreeType && !WORKTREE_TYPES.some((t) => t.id === body.worktreeType)) {
      return errorResponse("Invalid worktree type", 400, "INVALID_WORKTREE_TYPE");
    }

    // SECURITY: Validate projectPath to prevent path traversal
    const validatedPath = validateProjectPath(body.projectPath);
    if (body.projectPath && !validatedPath) {
      return errorResponse("Invalid project path", 400, "INVALID_PATH");
    }

    // SECURITY: Validate filePath to prevent path traversal
    const validatedFilePath = body.filePath ? validateProjectPath(body.filePath) : undefined;
    if (body.filePath && !validatedFilePath) {
      return errorResponse("Invalid file path", 400, "INVALID_FILE_PATH");
    }

    const input: CreateSessionInput = {
      name: body.name || "Terminal",
      projectPath: validatedPath,
      githubRepoId: body.githubRepoId,
      worktreeBranch: body.worktreeBranch,
      projectId: resolvedProjectId,
      // Terminal type (shell, agent, file, browser, loop)
      terminalType: body.terminalType,
      filePath: validatedFilePath,
      profileId: body.profileId,
      agentProvider: body.agentProvider as CreateSessionInput["agentProvider"],
      autoLaunchAgent: body.autoLaunchAgent,
      agentFlags: body.agentFlags,
      // Parent session for team orchestration
      parentSessionId: body.parentSessionId,
      // Loop agent config
      loopConfig: body.loopConfig as CreateSessionInput["loopConfig"],
      // Feature session fields
      startupCommand: body.startupCommand,
      featureDescription: body.featureDescription,
      createWorktree: body.createWorktree,
      baseBranch: body.baseBranch,
      worktreeType: body.worktreeType as CreateSessionInput["worktreeType"],
      // Plugin-level dedup + generic metadata passthrough
      scopeKey: body.scopeKey ?? null,
      typeMetadata: body.typeMetadata,
    };

    const { session: newSession, reused } =
      await SessionService.createSessionWithDedupFlag(userId, input);

    if (!reused) broadcastSidebarChanged(userId);

    // F2: surface the reused flag so the client can avoid dispatching a
    // duplicate CREATE for scope-key dedup hits. Keep the TerminalSession
    // shape at the top level for back-compat; attach `_reused` alongside
    // the standard fields.
    return NextResponse.json(
      { ...newSession, _reused: reused },
      { status: reused ? 200 : 201 }
    );
  } catch (error) {
    log.error("Error creating session", { error: String(error) });

    if (error instanceof SessionService.SessionServiceError) {
      return errorResponse(error.message, 400, error.code);
    }

    return errorResponse("Failed to create session", 500);
  }
});
