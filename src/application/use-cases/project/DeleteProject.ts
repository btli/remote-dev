import { ProjectRepository } from "@/application/ports/ProjectRepository";
import type { SessionRepository } from "@/application/ports/SessionRepository";
import type { TmuxGateway } from "@/application/ports/TmuxGateway";
import { createLogger } from "@/lib/logger";

const log = createLogger("DeleteProject");

export class DeleteProject {
  constructor(
    private readonly repo: ProjectRepository,
    private readonly sessionRepo: SessionRepository,
    private readonly tmuxGateway: TmuxGateway
  ) {}

  /**
   * Delete a project and close any sessions it owns.
   *
   * We explicitly kill tmux for owned sessions here so the server side does not
   * leak tmux processes when the DB row disappears via FK cascade. If the
   * project has an owning user we target only that user; otherwise we iterate
   * sessions discovered via the project record (userId lookup).
   *
   * The DB-level FK is `ON DELETE CASCADE`, so the DB row deletion handles
   * removal of session rows; this method just handles the side effects.
   */
  async execute(id: string): Promise<void> {
    const project = await this.repo.findById(id);
    if (!project) {
      // Project already gone — no-op.
      return;
    }

    // Find all sessions owned by this project for the owning user.
    // Active sessions need their tmux processes terminated before the DB row
    // disappears via ON DELETE CASCADE.
    let sessions: Awaited<ReturnType<SessionRepository["findByProject"]>> = [];
    try {
      sessions = await this.sessionRepo.findByProject(id, project.userId);
    } catch (error) {
      log.warn("Failed to list sessions for project delete", {
        projectId: id,
        error: String(error),
      });
    }

    const liveSessions = sessions.filter((s) => !s.status.isClosed());

    for (const session of liveSessions) {
      const tmuxName = session.tmuxSessionName.toString();
      try {
        await this.tmuxGateway.killSession(tmuxName);
      } catch (error) {
        log.warn("Failed to kill tmux on project delete", {
          projectId: id,
          sessionId: session.id,
          tmuxName,
          error: String(error),
        });
      }
    }

    // ON DELETE CASCADE on terminal_session.project_id drops the DB rows.
    await this.repo.delete(id);
  }
}
