/**
 * WorktreeGatewayImpl - Implementation of WorktreeGateway using existing WorktreeService.
 *
 * This adapter wraps the existing WorktreeService to implement the WorktreeGateway interface.
 */

import type {
  WorktreeGateway,
  WorktreeInfo,
  CreateWorktreeOptions,
  CreateWorktreeResult,
} from "@/application/ports/WorktreeGateway";
import * as WorktreeService from "@/services/worktree-service";

export class WorktreeGatewayImpl implements WorktreeGateway {
  /**
   * Check if a path is a git repository.
   */
  async isGitRepo(path: string): Promise<boolean> {
    return WorktreeService.isGitRepo(path);
  }

  /**
   * Create a new worktree with a new branch.
   */
  async createWorktree(
    options: CreateWorktreeOptions
  ): Promise<CreateWorktreeResult> {
    const result = await WorktreeService.createBranchWithWorktree(
      options.repoPath,
      options.branchName,
      options.baseBranch,
      options.targetPath
    );

    return {
      worktreePath: result.worktreePath,
      branchName: result.branch,
      created: true,
    };
  }

  /**
   * Remove a worktree.
   */
  async removeWorktree(
    repoPath: string,
    worktreePath: string,
    force?: boolean
  ): Promise<void> {
    await WorktreeService.removeWorktree(repoPath, worktreePath, force);
  }

  /**
   * List all worktrees for a repository.
   */
  async listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
    const worktrees = await WorktreeService.listWorktrees(repoPath);
    return worktrees.map((wt) => ({
      path: wt.path,
      branch: wt.branch,
      commit: wt.commit,
      isLocked: wt.isLocked,
      isPrunable: wt.isPrunable,
    }));
  }

  /**
   * Copy .env files from main repo to worktree.
   */
  async copyEnvFiles(repoPath: string, worktreePath: string): Promise<void> {
    WorktreeService.copyEnvFilesToWorktree(repoPath, worktreePath);
  }

  /**
   * Sanitize a string into a valid branch name.
   */
  sanitizeBranchName(input: string): string {
    return WorktreeService.sanitizeBranchName(input);
  }
}
