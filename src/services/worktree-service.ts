/**
 * WorktreeService - Manages git worktrees for branch isolation
 */
import { execFile, execFileNoThrow, execFileCheck } from "@/lib/exec";
import type { WorktreeInfo, BranchInfo } from "@/types/github";
import { existsSync, mkdirSync, copyFileSync, constants as fsConstants, accessSync } from "fs";
import { join, basename, dirname } from "path";
import { WorktreeServiceError } from "@/lib/errors";

/**
 * Files that should be copied from main repo to worktree.
 * These are development environment files that are typically gitignored.
 * Excludes production files for security.
 */
const ENV_FILES_TO_COPY = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
] as const;

/**
 * Files that should NOT be copied (for security).
 * Listed for documentation purposes.
 */
// const ENV_FILES_TO_SKIP = [
//   ".env.production",
//   ".env.production.local",
//   ".env.test",
// ] as const;

// Re-export for backwards compatibility
export { WorktreeServiceError };

/**
 * Status of a worktree before removal
 */
export interface WorktreeStatus {
  exists: boolean;
  isRegistered: boolean;
  hasUncommittedChanges: boolean;
  hasUntrackedFiles: boolean;
  hasUnpushedCommits: boolean;
  branch: string | null;
  uncommittedFileCount: number;
  untrackedFileCount: number;
  unpushedCommitCount: number;
}

/**
 * Result of a worktree removal operation
 */
export interface RemoveWorktreeResult {
  success: boolean;
  alreadyRemoved: boolean;
  hadUncommittedChanges: boolean;
  hadUnpushedCommits: boolean;
  message: string;
}

/**
 * Check if a directory is a git repository
 */
export async function isGitRepo(path: string): Promise<boolean> {
  return execFileCheck("git", ["-C", path, "rev-parse", "--git-dir"]);
}

/**
 * Fetch all refs from origin remote to ensure up-to-date remote tracking branches.
 * This prevents creating worktrees from stale origin/* references.
 *
 * @param repoPath - Path to the git repository
 * @returns true if fetch succeeded, false if it failed (but operation can continue)
 */
async function fetchRemoteRefs(repoPath: string): Promise<boolean> {
  const fetchResult = await execFileNoThrow("git", [
    "-C",
    repoPath,
    "fetch",
    "origin",
  ]);

  if (fetchResult.exitCode !== 0) {
    console.warn(
      `Warning: Could not fetch from origin: ${fetchResult.stderr}`
    );
    return false;
  }

  return true;
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

  // Fetch remote refs to ensure we have the latest
  await fetchRemoteRefs(repoPath);

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
 * Remove a worktree with safety checks
 *
 * @param repoPath - Path to the main repository
 * @param worktreePath - Path to the worktree to remove
 * @param force - Force removal even with uncommitted changes (default: false)
 * @returns Result with details about what was removed/lost
 * @throws WorktreeServiceError with code HAS_UNCOMMITTED_CHANGES if not forced
 */
export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  force = false
): Promise<RemoveWorktreeResult> {
  // Get worktree status before removal
  const status = await getWorktreeStatus(repoPath, worktreePath);

  // If worktree doesn't exist and isn't registered, it's already removed
  if (!status.exists && !status.isRegistered) {
    // Try to prune any stale worktree entries
    await execFileNoThrow("git", ["-C", repoPath, "worktree", "prune"]);

    return {
      success: true,
      alreadyRemoved: true,
      hadUncommittedChanges: false,
      hadUnpushedCommits: false,
      message: "Worktree was already removed",
    };
  }

  // Check for uncommitted changes (unless force is true)
  if (!force && (status.hasUncommittedChanges || status.hasUntrackedFiles)) {
    const details: string[] = [];
    if (status.uncommittedFileCount > 0) {
      details.push(`${status.uncommittedFileCount} uncommitted file(s)`);
    }
    if (status.untrackedFileCount > 0) {
      details.push(`${status.untrackedFileCount} untracked file(s)`);
    }
    throw new WorktreeServiceError(
      `Worktree has ${details.join(" and ")} that will be lost`,
      "HAS_UNCOMMITTED_CHANGES",
      `Branch: ${status.branch || "unknown"}`
    );
  }

  // Check for unpushed commits (unless force is true)
  if (!force && status.hasUnpushedCommits) {
    throw new WorktreeServiceError(
      `Worktree has ${status.unpushedCommitCount} unpushed commit(s) on branch '${status.branch}'`,
      "HAS_UNPUSHED_COMMITS",
      "Push your commits before removing, or use force to proceed anyway"
    );
  }

  // If only registered but directory doesn't exist, just prune
  if (!status.exists && status.isRegistered) {
    await execFileNoThrow("git", ["-C", repoPath, "worktree", "prune"]);
    return {
      success: true,
      alreadyRemoved: false,
      hadUncommittedChanges: false,
      hadUnpushedCommits: false,
      message: "Pruned stale worktree entry",
    };
  }

  // Perform the actual removal
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

  return {
    success: true,
    alreadyRemoved: false,
    hadUncommittedChanges: status.hasUncommittedChanges || status.hasUntrackedFiles,
    hadUnpushedCommits: status.hasUnpushedCommits,
    message: force && (status.hasUncommittedChanges || status.hasUnpushedCommits)
      ? `Removed worktree (warning: had uncommitted changes or unpushed commits)`
      : "Worktree removed successfully",
  };
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
  // Validate repo path first
  if (!(await isGitRepo(repoPath))) {
    throw new WorktreeServiceError(
      "Not a git repository",
      "NOT_GIT_REPO",
      repoPath
    );
  }

  // Fetch remote refs to ensure we have the latest
  await fetchRemoteRefs(repoPath);

  // Create worktree with new branch based on the base branch
  // Build args to specify the start point for the new branch
  const targetPath =
    worktreePath ||
    join(dirname(repoPath), `${basename(repoPath)}-${sanitizeBranchName(branchName)}`);

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

  // Create worktree with new branch: git worktree add -b <branch> <path> [<start-point>]
  const args = ["-C", repoPath, "worktree", "add", "-b", branchName, targetPath];
  if (baseBranch) {
    // Try origin/baseBranch first, fall back to just baseBranch
    const remoteRef = `origin/${baseBranch}`;
    const checkRemote = await execFileNoThrow("git", [
      "-C",
      repoPath,
      "rev-parse",
      "--verify",
      remoteRef,
    ]);
    if (checkRemote.exitCode === 0) {
      args.push(remoteRef);
    } else {
      // Try local branch
      const checkLocal = await execFileNoThrow("git", [
        "-C",
        repoPath,
        "rev-parse",
        "--verify",
        baseBranch,
      ]);
      if (checkLocal.exitCode === 0) {
        args.push(baseBranch);
      }
      // If neither exists, let git use HEAD (no start-point specified)
    }
  }

  try {
    await execFile("git", args);
    return {
      branch: branchName,
      worktreePath: targetPath,
    };
  } catch (error) {
    const err = error as Error & { stderr?: string };
    throw new WorktreeServiceError(
      "Failed to create branch with worktree",
      "CREATE_FAILED",
      err.stderr || err.message
    );
  }
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

/**
 * Check if a worktree path is registered with git
 */
export async function isWorktreeRegistered(
  repoPath: string,
  worktreePath: string
): Promise<boolean> {
  const worktrees = await listWorktrees(repoPath);
  return worktrees.some((wt) => wt.path === worktreePath);
}

/**
 * Get detailed status of a worktree before removal
 * This helps users understand what they might lose
 */
export async function getWorktreeStatus(
  repoPath: string,
  worktreePath: string
): Promise<WorktreeStatus> {
  const exists = existsSync(worktreePath);
  const isRegistered = await isWorktreeRegistered(repoPath, worktreePath);

  // If directory doesn't exist, return early
  if (!exists) {
    return {
      exists: false,
      isRegistered,
      hasUncommittedChanges: false,
      hasUntrackedFiles: false,
      hasUnpushedCommits: false,
      branch: null,
      uncommittedFileCount: 0,
      untrackedFileCount: 0,
      unpushedCommitCount: 0,
    };
  }

  // Get current branch
  const branch = await getCurrentBranch(worktreePath);

  // Get git status (staged + unstaged changes)
  const statusResult = await execFileNoThrow("git", [
    "-C",
    worktreePath,
    "status",
    "--porcelain",
  ]);

  const statusLines = statusResult.stdout
    .split("\n")
    .filter((line) => line.trim());

  // Count uncommitted (modified/staged) vs untracked
  let uncommittedFileCount = 0;
  let untrackedFileCount = 0;

  for (const line of statusLines) {
    if (line.startsWith("??")) {
      untrackedFileCount++;
    } else {
      uncommittedFileCount++;
    }
  }

  // Check for unpushed commits
  let unpushedCommitCount = 0;
  if (branch && branch !== "HEAD") {
    // Check if remote tracking branch exists
    const remoteRef = `origin/${branch}`;
    const hasRemote = await execFileCheck("git", [
      "-C",
      worktreePath,
      "rev-parse",
      "--verify",
      remoteRef,
    ]);

    if (hasRemote) {
      // Count commits ahead of remote
      const logResult = await execFileNoThrow("git", [
        "-C",
        worktreePath,
        "rev-list",
        "--count",
        `${remoteRef}..HEAD`,
      ]);
      if (logResult.exitCode === 0) {
        unpushedCommitCount = parseInt(logResult.stdout.trim(), 10) || 0;
      }
    } else {
      // No remote tracking - all commits are unpushed
      const logResult = await execFileNoThrow("git", [
        "-C",
        worktreePath,
        "rev-list",
        "--count",
        "HEAD",
      ]);
      if (logResult.exitCode === 0) {
        unpushedCommitCount = parseInt(logResult.stdout.trim(), 10) || 0;
      }
    }
  }

  return {
    exists,
    isRegistered,
    hasUncommittedChanges: uncommittedFileCount > 0,
    hasUntrackedFiles: untrackedFileCount > 0,
    hasUnpushedCommits: unpushedCommitCount > 0,
    branch,
    uncommittedFileCount,
    untrackedFileCount,
    unpushedCommitCount,
  };
}

/**
 * Result of copying env files to a worktree
 */
export interface CopyEnvFilesResult {
  /** Files that were successfully copied */
  copied: string[];
  /** Files that were skipped (didn't exist or weren't readable) */
  skipped: string[];
}

/**
 * Copy environment files from source repository to worktree.
 *
 * Copies development-related .env files that are typically gitignored.
 * This helps new worktrees have the same environment configuration
 * as the main repository without manual copying.
 *
 * Security: Does NOT copy production env files (.env.production, etc.)
 *
 * @param sourceRepoPath - Path to the main repository
 * @param worktreePath - Path to the worktree
 * @returns Result indicating which files were copied and skipped
 */
export function copyEnvFilesToWorktree(
  sourceRepoPath: string,
  worktreePath: string
): CopyEnvFilesResult {
  const result: CopyEnvFilesResult = {
    copied: [],
    skipped: [],
  };

  for (const envFile of ENV_FILES_TO_COPY) {
    const sourcePath = join(sourceRepoPath, envFile);
    const targetPath = join(worktreePath, envFile);

    try {
      // Check if source file exists and is readable
      accessSync(sourcePath, fsConstants.R_OK);

      // Check if target already exists (don't overwrite)
      if (existsSync(targetPath)) {
        console.log(`Skipping ${envFile}: already exists in worktree`);
        result.skipped.push(envFile);
        continue;
      }

      // Copy the file
      copyFileSync(sourcePath, targetPath);
      console.log(`Copied ${envFile} to worktree`);
      result.copied.push(envFile);
    } catch {
      // File doesn't exist or isn't readable - skip silently
      result.skipped.push(envFile);
    }
  }

  return result;
}

/**
 * Create a new worktree for a branch, optionally copying env files.
 *
 * This is a convenience wrapper around createWorktree that also
 * copies environment files after the worktree is created.
 *
 * @param repoPath - Path to the main repository
 * @param branch - Branch name to checkout in the worktree
 * @param options - Additional options
 * @returns The worktree path and copy result
 */
export async function createWorktreeWithEnv(
  repoPath: string,
  branch: string,
  options: {
    worktreePath?: string;
    createBranch?: boolean;
    copyEnvFiles?: boolean;
  } = {}
): Promise<{ worktreePath: string; envFilesCopied: CopyEnvFilesResult }> {
  const { worktreePath, createBranch = false, copyEnvFiles = true } = options;

  // Create the worktree
  const resultPath = await createWorktree(repoPath, branch, worktreePath, createBranch);

  // Copy env files if requested
  let envResult: CopyEnvFilesResult = { copied: [], skipped: [] };
  if (copyEnvFiles) {
    envResult = copyEnvFilesToWorktree(repoPath, resultPath);
  }

  return {
    worktreePath: resultPath,
    envFilesCopied: envResult,
  };
}

/**
 * Create a new branch with worktree, optionally copying env files.
 *
 * This is a convenience wrapper around createBranchWithWorktree that also
 * copies environment files after the worktree is created.
 *
 * @param repoPath - Path to the main repository
 * @param branchName - New branch name
 * @param options - Additional options
 * @returns The branch, worktree path, and copy result
 */
export async function createBranchWithWorktreeAndEnv(
  repoPath: string,
  branchName: string,
  options: {
    baseBranch?: string;
    worktreePath?: string;
    copyEnvFiles?: boolean;
  } = {}
): Promise<{
  branch: string;
  worktreePath: string;
  envFilesCopied: CopyEnvFilesResult;
}> {
  const { baseBranch, worktreePath, copyEnvFiles = true } = options;

  // Create the branch and worktree
  const result = await createBranchWithWorktree(
    repoPath,
    branchName,
    baseBranch,
    worktreePath
  );

  // Copy env files if requested
  let envResult: CopyEnvFilesResult = { copied: [], skipped: [] };
  if (copyEnvFiles) {
    envResult = copyEnvFilesToWorktree(repoPath, result.worktreePath);
  }

  return {
    branch: result.branch,
    worktreePath: result.worktreePath,
    envFilesCopied: envResult,
  };
}
