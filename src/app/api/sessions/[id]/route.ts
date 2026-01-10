import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as SessionService from "@/services/session-service";
import * as WorktreeService from "@/services/worktree-service";
import * as GitHubService from "@/services/github-service";
import * as TrashService from "@/services/trash-service";
import * as ScheduleService from "@/services/schedule-service";
import { notifySessionJobsRemoved } from "@/lib/scheduler-client";
import { getFolderPreferences } from "@/services/preferences-service";
import { SessionEndAnalysisService, type SessionEndType } from "@/services/session-end-analysis-service";
import { getEpisodicMemory } from "@/services/episodic-memory-service";
import { container } from "@/infrastructure/container";
import type { UpdateSessionInput, SessionStatus } from "@/types/session";
import { resolve } from "path";

/**
 * Validate a project path to prevent path traversal attacks.
 * SECURITY: Ensures paths are within allowed directories.
 */
function validateProjectPath(path: string | undefined): string | undefined {
  if (!path) return undefined;

  // Must be absolute path
  if (!path.startsWith("/")) {
    return undefined;
  }

  // Resolve to canonical path (removes .., ., etc.)
  const resolved = resolve(path);

  // Must be within home directory or /tmp
  const home = process.env.HOME || "/tmp";
  if (!resolved.startsWith(home) && !resolved.startsWith("/tmp")) {
    return undefined;
  }

  return resolved;
}

/**
 * Extract learnings from a closed session in background.
 *
 * This function analyzes the session transcript and updates
 * project knowledge with any patterns, conventions, skills discovered.
 */
async function extractLearnings(params: {
  sessionId: string;
  folderId: string;
  projectPath: string;
  agentProvider: string;
}): Promise<void> {
  const { sessionId, folderId, projectPath, agentProvider } = params;

  console.log(`[Learning] Starting extraction for session ${sessionId}`);

  try {
    // Create analysis service
    const analysisService = new SessionEndAnalysisService();

    // Analyze the session
    const analysis = await analysisService.analyze({
      sessionId,
      projectPath,
      agentProvider: agentProvider as "claude" | "codex" | "gemini" | "opencode",
      endType: "user_closed" as SessionEndType,
    });

    // Get or create project knowledge for this folder
    let knowledge = await container.projectKnowledgeRepository.findByFolderId(folderId);

    if (!knowledge) {
      // Create new project knowledge if it doesn't exist
      const { ProjectKnowledge } = await import("@/domain/entities/ProjectKnowledge");
      knowledge = ProjectKnowledge.create({
        folderId,
        userId: "", // Will be set from folder relationship
        techStack: [],
        metadata: { projectPath },
      });
    }

    // Add learnings to project knowledge
    let updated = knowledge;

    for (const learning of analysis.learnings) {
      if (learning.type === "pattern" || learning.type === "error_handling") {
        updated = updated.addPattern({
          type: learning.type === "error_handling" ? "gotcha" : "success",
          description: learning.description,
          context: learning.evidence,
          confidence: learning.confidence,
        });
      } else if (learning.type === "command") {
        updated = updated.addPattern({
          type: "success",
          description: `Command pattern: ${learning.description}`,
          context: learning.evidence,
          confidence: learning.confidence,
        });
      } else if (learning.type === "tool") {
        updated = updated.addPattern({
          type: "success",
          description: `Tool reliability: ${learning.description}`,
          context: learning.evidence,
          confidence: learning.confidence,
        });
      }
    }

    // Add improvements as skills or gotchas
    for (const improvement of analysis.improvements) {
      if (improvement.type === "skill") {
        updated = updated.addSkill({
          name: improvement.title,
          description: improvement.description,
          command: improvement.action || "",
          triggers: [],
          steps: [],
          scope: "project",
          verified: false,
        });
      } else if (improvement.type === "gotcha") {
        updated = updated.addPattern({
          type: "gotcha",
          description: improvement.description,
          context: improvement.action || "",
          confidence: 0.7,
        });
      }
    }

    // Save updated knowledge
    await container.projectKnowledgeRepository.save(updated);

    // Also store as Episode in Episodic Memory for vector search
    try {
      const episodicMemory = getEpisodicMemory(folderId);

      // Create episode from analysis
      const recordingId = episodicMemory.startRecording(
        sessionId,
        folderId,
        analysis.summary,
        agentProvider
      );

      // Complete the recording with reflection from analysis
      await episodicMemory.completeRecording(
        recordingId,
        analysis.outcome === "success" || analysis.outcome === "completed",
        analysis.summary,
        {
          whatWorked: analysis.learnings
            .filter(l => l.confidence > 0.7)
            .map(l => l.description),
          whatFailed: analysis.issues.map(i => i.description),
          keyInsights: analysis.improvements.map(i => `${i.title}: ${i.description}`),
          wouldDoDifferently: analysis.improvements
            .filter(i => i.action)
            .map(i => i.action)
            .join("; ") || undefined,
        },
        analysis.issues.map(i => i.type)
      );

      console.log(`[Learning] Stored episode for session ${sessionId}`);
    } catch (episodeError) {
      // Don't fail if episode storage fails
      console.warn(`[Learning] Failed to store episode for session ${sessionId}:`, episodeError);
    }

    console.log(
      `[Learning] Extracted ${analysis.learnings.length} learnings, ` +
      `${analysis.improvements.length} improvements for session ${sessionId}`
    );
  } catch (error) {
    console.error(`[Learning] Failed to extract for session ${sessionId}:`, error);
    throw error;
  }
}

/**
 * GET /api/sessions/:id - Get a single session
 */
export const GET = withAuth(async (_request, { userId, params }) => {
  const terminalSession = await SessionService.getSessionWithMetadata(
    params!.id,
    userId
  );

  if (!terminalSession) {
    return errorResponse("Session not found", 404);
  }

  return NextResponse.json(terminalSession);
});

/**
 * PATCH /api/sessions/:id - Update a session
 */
export const PATCH = withAuth(async (request, { userId, params }) => {
  const result = await parseJsonBody<{
    name?: string;
    status?: string;
    tabOrder?: number;
    projectPath?: string;
  }>(request);
  if ("error" in result) return result.error;
  const body = result.data;

  const updates: UpdateSessionInput = {};

  if (body.name !== undefined) updates.name = body.name;
  if (body.status !== undefined) updates.status = body.status as SessionStatus;
  if (body.tabOrder !== undefined) updates.tabOrder = body.tabOrder;
  
  // SECURITY: Validate projectPath to prevent path traversal
  if (body.projectPath !== undefined) {
    const validatedPath = validateProjectPath(body.projectPath);
    if (body.projectPath && !validatedPath) {
      return errorResponse("Invalid project path", 400, "INVALID_PATH");
    }
    updates.projectPath = validatedPath;
  }

  try {
    const updated = await SessionService.updateSession(
      params!.id,
      userId,
      updates
    );
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof SessionService.SessionServiceError) {
      const status = error.code === "SESSION_NOT_FOUND" ? 404 : 400;
      return errorResponse(error.message, status, error.code);
    }
    throw error;
  }
});

/**
 * DELETE /api/sessions/:id - Close a session
 *
 * Query params:
 * - deleteWorktree=true: Also delete the git worktree from disk
 * - trash=true: Move worktree to trash instead of permanent close
 */
export const DELETE = withAuth(async (request, { userId, params }) => {
  const id = params!.id;
  const { searchParams } = new URL(request.url);
  const deleteWorktree = searchParams.get("deleteWorktree") === "true";
  const shouldTrash = searchParams.get("trash") === "true";

  try {
    // Get session details for worktree operations
    const terminalSession = await SessionService.getSessionWithMetadata(
      id,
      userId
    );

    // Handle trash request for worktree sessions
    if (shouldTrash && terminalSession?.worktreeBranch && terminalSession?.projectPath) {
      const trashItem = await TrashService.trashResource(
        userId,
        "worktree",
        id
      );
      return NextResponse.json({ success: true, trashItemId: trashItem.id });
    }

    // If deleteWorktree is requested, handle worktree cleanup first
    if (deleteWorktree && terminalSession?.worktreeBranch && terminalSession?.projectPath) {
      let mainRepoPath: string | null = null;

      // Try to get the main repo path from GitHub repository
      if (terminalSession.githubRepoId) {
        const repo = await GitHubService.getRepository(
          terminalSession.githubRepoId,
          userId
        );
        mainRepoPath = repo?.localPath ?? null;
      }

      // Fall back to folder preferences for local repo path
      if (!mainRepoPath && terminalSession.folderId) {
        const folderPrefs = await getFolderPreferences(
          terminalSession.folderId,
          userId
        );
        mainRepoPath = folderPrefs?.localRepoPath ?? null;
      }

      if (mainRepoPath) {
        try {
          const result = await WorktreeService.removeWorktree(
            mainRepoPath,
            terminalSession.projectPath,
            true // force removal
          );
          if (result.alreadyRemoved) {
            console.log(
              `Worktree at ${terminalSession.projectPath} was already removed`
            );
          } else if (result.hadUncommittedChanges || result.hadUnpushedCommits) {
            console.warn(
              `Removed worktree at ${terminalSession.projectPath} with data loss: ${result.message}`
            );
          } else {
            console.log(
              `Removed worktree at ${terminalSession.projectPath} for session ${id}`
            );
          }
        } catch (worktreeError) {
          console.error("Failed to remove worktree:", worktreeError);
          // Continue with session closure even if worktree removal fails
        }
      }
    }

    // Disable any scheduled commands for this session
    try {
      const disabledCount = await ScheduleService.disableSessionSchedules(id);
      if (disabledCount > 0) {
        // Notify terminal server's scheduler to remove the jobs
        notifySessionJobsRemoved(id).catch((err) =>
          console.warn("[API] Failed to notify scheduler of session job removal:", err)
        );
        console.log(`Disabled ${disabledCount} schedules for session ${id}`);
      }
    } catch (scheduleError) {
      console.error("Failed to disable schedules:", scheduleError);
      // Continue with session closure even if schedule cleanup fails
    }

    await SessionService.closeSession(id, userId);

    // Extract learnings in background (fire-and-forget)
    // This doesn't block the close response
    if (terminalSession?.folderId && terminalSession?.projectPath && terminalSession?.agentProvider) {
      extractLearnings({
        sessionId: id,
        folderId: terminalSession.folderId,
        projectPath: terminalSession.projectPath,
        agentProvider: terminalSession.agentProvider,
      }).catch((err) => {
        console.error("[Learning] Failed to extract learnings:", err);
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SessionService.SessionServiceError) {
      const status = error.code === "SESSION_NOT_FOUND" ? 404 : 400;
      return errorResponse(error.message, status, error.code);
    }

    if (error instanceof TrashService.TrashServiceError) {
      return errorResponse(error.message, 400, error.code);
    }

    throw error;
  }
});
