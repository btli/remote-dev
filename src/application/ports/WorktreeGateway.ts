/**
 * WorktreeGateway - Port interface for git worktree operations.
 *
 * This interface abstracts git worktree management for branch isolation.
 */

export interface WorktreeInfo {
  path: string;
  branch: string;
  commit: string;
  isLocked: boolean;
  isPrunable: boolean;
}

export interface CreateWorktreeOptions {
  repoPath: string;
  branchName: string;
  baseBranch?: string;
  targetPath?: string;
}

export interface CreateWorktreeResult {
  worktreePath: string;
  branchName: string;
  created: boolean;
}

export interface WorktreeGateway {
  /**
   * Check if a path is a git repository.
   */
  isGitRepo(path: string): Promise<boolean>;

  /**
   * Create a new worktree with a new branch.
   */
  createWorktree(options: CreateWorktreeOptions): Promise<CreateWorktreeResult>;

  /**
   * Remove a worktree.
   */
  removeWorktree(
    repoPath: string,
    worktreePath: string,
    force?: boolean
  ): Promise<void>;

  /**
   * List all worktrees for a repository.
   */
  listWorktrees(repoPath: string): Promise<WorktreeInfo[]>;

  /**
   * Copy .env files from main repo to worktree.
   */
  copyEnvFiles(repoPath: string, worktreePath: string): Promise<void>;

  /**
   * Sanitize a string into a valid branch name.
   */
  sanitizeBranchName(input: string): string;
}
