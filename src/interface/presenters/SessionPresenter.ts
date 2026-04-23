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
      projectId: session.projectId,
      profileId: session.profileId,
      terminalType: session.terminalType,
      agentProvider: session.agentProvider,
      agentExitState: session.agentExitState,
      agentExitCode: session.agentExitCode,
      agentExitedAt: session.agentExitedAt,
      agentRestartCount: session.agentRestartCount,
      agentActivityStatus: session.agentActivityStatus ?? null,
      typeMetadata: session.typeMetadata,
      // Scope-key dedup field (may not be tracked on the domain entity yet —
      // surface null so API consumers always see a stable shape).
      scopeKey:
        (session as unknown as { scopeKey?: string | null }).scopeKey ?? null,
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
