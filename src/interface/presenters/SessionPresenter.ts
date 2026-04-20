/**
 * SessionPresenter - Transforms domain Session entities to API responses.
 *
 * This presenter converts internal domain objects to the API contract,
 * ensuring backward compatibility with existing clients.
 */

import type { Session } from "@/domain/entities/Session";
import type { TerminalSession } from "@/types/session";

export class SessionPresenter {
  /**
   * Convert a Session domain entity to the API response format.
   */
  static toResponse(session: Session): TerminalSession {
    return {
      id: session.id,
      userId: session.userId,
      name: session.name,
      tmuxSessionName: session.tmuxSessionName.toString(),
      projectPath: session.projectPath,
      githubRepoId: session.githubRepoId,
      worktreeBranch: session.worktreeBranch,
      worktreeType: (session.worktreeType as TerminalSession["worktreeType"]) ?? null,
      folderId: session.folderId,
      // Phase 3: project id is not yet surfaced through the Session domain entity.
      // It is dual-written at insert time and read directly from the DB row in
      // SessionService; the presenter path (used by folder-oriented API routes)
      // reports null until Phase 4 promotes Session to a project-aware entity.
      projectId: null,
      profileId: session.profileId,
      terminalType: session.terminalType,
      agentProvider: session.agentProvider,
      agentExitState: session.agentExitState,
      agentExitCode: session.agentExitCode,
      agentExitedAt: session.agentExitedAt,
      agentRestartCount: session.agentRestartCount,
      agentActivityStatus: session.agentActivityStatus ?? null,
      typeMetadata: session.typeMetadata,
      parentSessionId: session.parentSessionId,
      status: session.status.toString() as TerminalSession["status"],
      pinned: session.pinned,
      tabOrder: session.tabOrder,
      lastActivityAt: session.lastActivityAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  /**
   * Convert multiple Session entities to API response format.
   */
  static toResponseMany(sessions: Session[]): TerminalSession[] {
    return sessions.map((s) => SessionPresenter.toResponse(s));
  }
}
