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
      folderId: session.folderId,
      profileId: session.profileId,
      agentProvider: session.agentProvider,
      splitGroupId: session.splitGroupId,
      splitOrder: session.splitOrder,
      splitSize: session.splitSize,
      status: session.status.toString() as TerminalSession["status"],
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
