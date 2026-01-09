import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { db } from "@/db";
import { sessionFolders, terminalSessions, orchestratorSessions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import {
  installAgentHooks,
  checkHooksInstalled,
  type AgentProvider,
} from "@/services/agent-hooks-service";

const VALID_PROVIDERS: AgentProvider[] = ["claude", "codex", "gemini", "opencode"];

/**
 * GET /api/folders/[id]/hooks - Check hook installation status
 *
 * Returns which agent hooks are installed for this folder's project.
 */
export const GET = withAuth(async (request, { userId, params }) => {
  try {
    const folderId = params!.id;

    // Get folder
    const folder = await db
      .select()
      .from(sessionFolders)
      .where(
        and(
          eq(sessionFolders.id, folderId),
          eq(sessionFolders.userId, userId)
        )
      )
      .limit(1);

    if (folder.length === 0) {
      return errorResponse("Folder not found", 404, "FOLDER_NOT_FOUND");
    }

    // Get project path from folder's sessions or preferences
    // Look for the most recent session with a project path
    const sessions = await db
      .select()
      .from(terminalSessions)
      .where(
        and(
          eq(terminalSessions.folderId, folderId),
          eq(terminalSessions.userId, userId)
        )
      )
      .limit(1);

    const projectPath = sessions[0]?.projectPath;

    if (!projectPath) {
      return NextResponse.json({
        folderId,
        folderName: folder[0].name,
        projectPath: null,
        hooks: null,
        message: "No project path found for this folder",
      });
    }

    // Check hook status for each provider
    const hookStatus: Record<AgentProvider, boolean> = {
      claude: await checkHooksInstalled("claude", projectPath),
      codex: await checkHooksInstalled("codex", projectPath),
      gemini: await checkHooksInstalled("gemini", projectPath),
      opencode: await checkHooksInstalled("opencode", projectPath),
    };

    return NextResponse.json({
      folderId,
      folderName: folder[0].name,
      projectPath,
      hooks: hookStatus,
    });
  } catch (error) {
    console.error("[API] Failed to check hooks:", error);
    return errorResponse("Failed to check hooks", 500);
  }
});

/**
 * POST /api/folders/[id]/hooks - Install agent hooks for a folder
 *
 * Installs hooks for the specified agent provider(s) in the folder's project.
 * Requires a folder orchestrator to exist for proper routing.
 */
export const POST = withAuth(async (request, { userId, params }) => {
  try {
    const folderId = params!.id;

    const result = await parseJsonBody<{
      providers: AgentProvider[];
      sessionId?: string; // Optional: specific session ID to use
    }>(request);

    if ("error" in result) return result.error;
    const { providers, sessionId } = result.data;

    // Validate providers
    if (!providers || !Array.isArray(providers) || providers.length === 0) {
      return errorResponse(
        "providers is required and must be a non-empty array",
        400,
        "INVALID_PROVIDERS"
      );
    }

    for (const provider of providers) {
      if (!VALID_PROVIDERS.includes(provider)) {
        return errorResponse(
          `Invalid provider: ${provider}. Must be one of: ${VALID_PROVIDERS.join(", ")}`,
          400,
          "INVALID_PROVIDER"
        );
      }
    }

    // Get folder
    const folder = await db
      .select()
      .from(sessionFolders)
      .where(
        and(
          eq(sessionFolders.id, folderId),
          eq(sessionFolders.userId, userId)
        )
      )
      .limit(1);

    if (folder.length === 0) {
      return errorResponse("Folder not found", 404, "FOLDER_NOT_FOUND");
    }

    // Get folder orchestrator (required for hook routing)
    const orchestrator = await db
      .select()
      .from(orchestratorSessions)
      .where(
        and(
          eq(orchestratorSessions.scopeId, folderId),
          eq(orchestratorSessions.scopeType, "folder"),
          eq(orchestratorSessions.userId, userId)
        )
      )
      .limit(1);

    if (orchestrator.length === 0) {
      return errorResponse(
        "Folder orchestrator required. Create one first via POST /api/folders/{id}/orchestrator",
        400,
        "ORCHESTRATOR_REQUIRED"
      );
    }

    // Get project path
    let projectPath: string | null = null;

    if (sessionId) {
      // Use specific session's project path
      const session = await db
        .select()
        .from(terminalSessions)
        .where(
          and(
            eq(terminalSessions.id, sessionId),
            eq(terminalSessions.userId, userId)
          )
        )
        .limit(1);

      projectPath = session[0]?.projectPath || null;
    } else {
      // Find project path from folder's sessions
      const sessions = await db
        .select()
        .from(terminalSessions)
        .where(
          and(
            eq(terminalSessions.folderId, folderId),
            eq(terminalSessions.userId, userId)
          )
        );

      // Use the first session with a project path
      for (const session of sessions) {
        if (session.projectPath) {
          projectPath = session.projectPath;
          break;
        }
      }
    }

    if (!projectPath) {
      return errorResponse(
        "No project path found for this folder. Create a session with a project path first.",
        400,
        "NO_PROJECT_PATH"
      );
    }

    // Install hooks for each provider
    const results: Array<{
      provider: AgentProvider;
      success: boolean;
      message: string;
      configPath?: string;
    }> = [];

    // Use the orchestrator's session ID for hook configuration
    const orchestratorSessionId = orchestrator[0].sessionId;

    for (const provider of providers) {
      const installResult = await installAgentHooks(
        provider,
        projectPath,
        orchestratorSessionId,
        folderId
      );

      results.push({
        provider,
        ...installResult,
      });
    }

    const allSucceeded = results.every((r) => r.success);
    const anySucceeded = results.some((r) => r.success);

    return NextResponse.json(
      {
        folderId,
        folderName: folder[0].name,
        projectPath,
        orchestratorId: orchestrator[0].id,
        results,
        success: allSucceeded,
        message: allSucceeded
          ? "All hooks installed successfully"
          : anySucceeded
            ? "Some hooks installed successfully"
            : "Failed to install hooks",
      },
      { status: allSucceeded ? 200 : anySucceeded ? 207 : 500 }
    );
  } catch (error) {
    console.error("[API] Failed to install hooks:", error);
    return errorResponse("Failed to install hooks", 500);
  }
});

/**
 * DELETE /api/folders/[id]/hooks - Remove agent hooks for a folder
 *
 * Removes hooks for the specified agent provider(s) from the folder's project.
 */
export const DELETE = withAuth(async (request, { userId, params }) => {
  try {
    const folderId = params!.id;

    const { searchParams } = new URL(request.url);
    const providersParam = searchParams.get("providers");

    if (!providersParam) {
      return errorResponse(
        "providers query parameter is required",
        400,
        "MISSING_PROVIDERS"
      );
    }

    const providers = providersParam.split(",") as AgentProvider[];

    // Validate providers
    for (const provider of providers) {
      if (!VALID_PROVIDERS.includes(provider)) {
        return errorResponse(
          `Invalid provider: ${provider}`,
          400,
          "INVALID_PROVIDER"
        );
      }
    }

    // Get folder
    const folder = await db
      .select()
      .from(sessionFolders)
      .where(
        and(
          eq(sessionFolders.id, folderId),
          eq(sessionFolders.userId, userId)
        )
      )
      .limit(1);

    if (folder.length === 0) {
      return errorResponse("Folder not found", 404, "FOLDER_NOT_FOUND");
    }

    // TODO: Implement hook removal
    // For now, return a message indicating this is not yet implemented
    return NextResponse.json({
      folderId,
      folderName: folder[0].name,
      message: "Hook removal not yet implemented. Please remove hooks manually.",
      providers,
    });
  } catch (error) {
    console.error("[API] Failed to remove hooks:", error);
    return errorResponse("Failed to remove hooks", 500);
  }
});
