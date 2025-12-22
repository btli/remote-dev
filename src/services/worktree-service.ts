/**
 * WorktreeService - Manages git worktrees for branch isolation
 */
import { execFile, execFileNoThrow, execFileCheck } from "@/lib/exec";
import type { WorktreeInfo, BranchInfo } from "@/types/github";
import { existsSync, mkdirSync } from "fs";
import { join, basename, dirname } from "path";
import { WorktreeServiceError } from "@/lib/errors";

export { WorktreeServiceError };

/**
 * Check if a directory is a git repository
 */
export async function isGitRepo(path: string): Promise<boolean> {
  return execFileCheck("git", ["-C", path, "rev-parse", "--git-dir"]);
}

/**
 * Get the root directory of a git repository
 */
export async function getRepoRoot(path: string): Promise<string | null> {
  const result = await execFileNoThrow("git", [
    "-C",
    path,
    "rev-parse",
    "--show-toplevel",
  ]);
  return result.exitCode === 0 ? result.stdout : null;
}

/**
 * List all worktrees for a repository
 */
export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  const result = await execFileNoThrow("git", [
    "-C",
    repoPath,
    "worktree",
    "list",
    "--porcelain",
  ]);

  if (result.exitCode !== 0 || !result.stdout) {
    return [];
  }

  const worktrees: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};

  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) {
        worktrees.push(current as WorktreeInfo);
      }
      current = {
        path: line.substring(9),
        isLocked: false,
        isPrunable: false,
      };
    } else if (line.startsWith("HEAD ")) {
      current.commit = line.substring(5);
    } else if (line.startsWith("branch ")) {
      current.branch = line.substring(7).replace("refs/heads/", "");
    } else if (line === "locked") {
      current.isLocked = true;
    } else if (line === "prunable") {
      current.isPrunable = true;
    }
  }

  if (current.path) {
    worktrees.push(current as WorktreeInfo);
  }

  return worktrees;
}

/**
 * Get all branches in a repository
 */
export async function getBranches(repoPath: string): Promise<BranchInfo[]> {
  const result = await execFileNoThrow("git", [
    "-C",
    repoPath,
    "branch",
    "-a",
    "--format=%(refname:short)|%(objectname:short)|%(HEAD)",
  ]);

  if (result.exitCode !== 0 || !result.stdout) {
    return [];
  }

  // Get the default branch
  const defaultBranchResult = await execFileNoThrow("git", [
    "-C",
    repoPath,
    "symbolic-ref",
    "--short",
    "HEAD",
  ]);
  const defaultBranch = defaultBranchResult.stdout || "main";

  return result.stdout.split("\n").map((line) => {
    const [name] = line.split("|");
    const isRemote = name.startsWith("origin/") || name.includes("/");
    return {
      name,
      isRemote,
      isDefault: name === defaultBranch,
    };
  });
}

/**
 * Create a new worktree for a branch
 * @param repoPath - Path to the main repository
 * @param branch - Branch name to checkout in the worktree
 * @param worktreePath - Path for the new worktree (optional, auto-generated if not provided)
 * @param createBranch - Create a new branch if it doesn't exist
 */
export async function createWorktree(
  repoPath: string,
  branch: string,
  worktreePath?: string,
  createBranch = false
): Promise<string> {
  // Validate repo path
  if (!(await isGitRepo(repoPath))) {
    throw new WorktreeServiceError(
      "Not a git repository",
      "NOT_GIT_REPO",
      repoPath
    );
  }

  // Generate worktree path if not provided
  const targetPath =
    worktreePath ||
    join(dirname(repoPath), `${basename(repoPath)}-${sanitizeBranchName(branch)}`);

  // Check if path already exists
  if (existsSync(targetPath)) {
    throw new WorktreeServiceError(
      "Worktree path already exists",
      "PATH_EXISTS",
      targetPath
    );
  }

  // Create parent directory if needed
  const parentDir = dirname(targetPath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  // Build the git worktree add command
  const args = ["-C", repoPath, "worktree", "add"];

  if (createBranch) {
    args.push("-b", branch, targetPath);
  } else {
    args.push(targetPath, branch);
  }

  try {
    await execFile("git", args);
    return targetPath;
  } catch (error) {
    const err = error as Error & { stderr?: string };
    throw new WorktreeServiceError(
      "Failed to create worktree",
      "CREATE_FAILED",
      err.stderr || err.message
    );
  }
}

/**
 * Remove a worktree
 */
export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  force = false
): Promise<void> {
  const args = ["-C", repoPath, "worktree", "remove"];

  if (force) {
    args.push("--force");
  }

  args.push(worktreePath);

  try {
    await execFile("git", args);
  } catch (error) {
    const err = error as Error & { stderr?: string };
    throw new WorktreeServiceError(
      "Failed to remove worktree",
      "REMOVE_FAILED",
      err.stderr || err.message
    );
  }
}

/**
 * Prune stale worktrees
 */
export async function pruneWorktrees(repoPath: string): Promise<void> {
  try {
    await execFile("git", ["-C", repoPath, "worktree", "prune"]);
  } catch (error) {
    const err = error as Error & { stderr?: string };
    throw new WorktreeServiceError(
      "Failed to prune worktrees",
      "PRUNE_FAILED",
      err.stderr || err.message
    );
  }
}

/**
 * Create a new branch and worktree for it
 */
export async function createBranchWithWorktree(
  repoPath: string,
  branchName: string,
  baseBranch?: string,
  worktreePath?: string
): Promise<{ branch: string; worktreePath: string }> {
  // If base branch specified, checkout from it
  if (baseBranch) {
    await execFile("git", ["-C", repoPath, "fetch", "origin", baseBranch]);
  }

  // Create worktree with new branch
  const targetPath = await createWorktree(
    repoPath,
    branchName,
    worktreePath,
    true // createBranch = true
  );

  return {
    branch: branchName,
    worktreePath: targetPath,
  };
}

/**
 * Generate a worktree-safe branch name
 */
export function sanitizeBranchName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Generate a unique branch name for a session
 */
export function generateBranchName(
  sessionId: string,
  prefix = "session"
): string {
  const shortId = sessionId.substring(0, 8);
  const timestamp = Date.now().toString(36);
  return `${prefix}/${shortId}-${timestamp}`;
}

/**
 * Get the current branch of a worktree or repository
 */
export async function getCurrentBranch(path: string): Promise<string | null> {
  const result = await execFileNoThrow("git", [
    "-C",
    path,
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ]);
  return result.exitCode === 0 ? result.stdout : null;
}

/**
 * Check if there are uncommitted changes in a worktree
 */
export async function hasUncommittedChanges(path: string): Promise<boolean> {
  const result = await execFileNoThrow("git", [
    "-C",
    path,
    "status",
    "--porcelain",
  ]);
  return result.stdout.trim().length > 0;
}
