/**
 * CreateSessionUseCase - Orchestrates the creation of a new terminal session.
 *
 * This use case handles:
 * 1. Creating the domain Session entity
 * 2. Setting up the tmux session
 * 3. Optionally creating a git worktree
 * 4. Persisting to the database
 * 5. Cleaning up on failure
 */

import { Session } from "@/domain/entities/Session";
import type { SessionRepository } from "@/application/ports/SessionRepository";
import type { TmuxGateway } from "@/application/ports/TmuxGateway";
import type { WorktreeGateway } from "@/application/ports/WorktreeGateway";
import type { AgentProviderType } from "@/types/session";

export interface CreateSessionInput {
  userId: string;
  name: string;
  projectPath?: string;
  folderId?: string;
  profileId?: string;
  agentProvider?: AgentProviderType;
  // Worktree options
  createWorktree?: boolean;
  featureDescription?: string;
  baseBranch?: string;
  // Session options
  startupCommand?: string;
  environment?: Record<string, string>;
}

export interface CreateSessionOutput {
  session: Session;
  worktreePath?: string;
}

export class CreateSessionUseCase {
  constructor(
    private readonly sessionRepository: SessionRepository,
    private readonly tmuxGateway: TmuxGateway,
    private readonly worktreeGateway: WorktreeGateway
  ) {}

  async execute(input: CreateSessionInput): Promise<CreateSessionOutput> {
    // Get next tab order
    const tabOrder = await this.sessionRepository.getNextTabOrder(input.userId);

    // Determine working directory
    let workingPath = input.projectPath ?? process.env.HOME;
    let worktreeBranch: string | null = null;
    let createdWorktree = false;

    // Handle worktree creation if requested
    if (input.createWorktree && input.projectPath && input.featureDescription) {
      // Validate git repo
      const isRepo = await this.worktreeGateway.isGitRepo(input.projectPath);
      if (!isRepo) {
        throw new CreateSessionError(
          "Project path is not a git repository",
          "NOT_GIT_REPO"
        );
      }

      // Generate branch name from feature description
      const branchName = `feature/${this.worktreeGateway.sanitizeBranchName(
        input.featureDescription
      )}`;

      try {
        const result = await this.worktreeGateway.createWorktree({
          repoPath: input.projectPath,
          branchName,
          baseBranch: input.baseBranch,
        });
        workingPath = result.worktreePath;
        worktreeBranch = result.branchName;
        createdWorktree = true;

        // Copy .env files
        await this.worktreeGateway.copyEnvFiles(
          input.projectPath,
          result.worktreePath
        );
      } catch (error) {
        throw new CreateSessionError(
          `Failed to create worktree: ${error instanceof Error ? error.message : "Unknown error"}`,
          "WORKTREE_CREATION_FAILED"
        );
      }
    }

    // Create the domain entity
    const session = Session.create({
      userId: input.userId,
      name: input.name,
      projectPath: workingPath,
      folderId: input.folderId,
      profileId: input.profileId,
      agentProvider: input.agentProvider,
      worktreeBranch,
      tabOrder,
    });

    // Create tmux session
    try {
      await this.tmuxGateway.createSession({
        sessionName: session.tmuxSessionName.toString(),
        workingDirectory: workingPath ?? undefined,
        startupCommand: input.startupCommand,
        environment: input.environment,
      });
    } catch (error) {
      // Cleanup worktree if we created one
      if (createdWorktree && input.projectPath && workingPath) {
        await this.worktreeGateway
          .removeWorktree(input.projectPath, workingPath, true)
          .catch(() => {
            console.error(`Failed to cleanup orphaned worktree: ${workingPath}`);
          });
      }
      throw new CreateSessionError(
        `Failed to create tmux session: ${error instanceof Error ? error.message : "Unknown error"}`,
        "TMUX_CREATION_FAILED"
      );
    }

    // Persist to database
    try {
      const savedSession = await this.sessionRepository.save(session);
      return {
        session: savedSession,
        worktreePath: createdWorktree ? workingPath ?? undefined : undefined,
      };
    } catch (error) {
      // Cleanup tmux session
      await this.tmuxGateway
        .killSession(session.tmuxSessionName.toString())
        .catch(() => {
          console.error(
            `Failed to cleanup orphaned tmux: ${session.tmuxSessionName.toString()}`
          );
        });

      // Cleanup worktree if we created one
      if (createdWorktree && input.projectPath && workingPath) {
        await this.worktreeGateway
          .removeWorktree(input.projectPath, workingPath, true)
          .catch(() => {
            console.error(`Failed to cleanup orphaned worktree: ${workingPath}`);
          });
      }

      throw new CreateSessionError(
        `Failed to persist session: ${error instanceof Error ? error.message : "Unknown error"}`,
        "PERSISTENCE_FAILED"
      );
    }
  }
}

export class CreateSessionError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "CreateSessionError";
  }
}
