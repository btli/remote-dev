/**
 * Git Tools - Git and Worktree Operations
 *
 * Tools for managing git repositories, worktrees, and GitHub integration.
 * Essential for feature branch workflows.
 */
import { z } from "zod";
import { createTool } from "../registry.js";
import { successResult } from "../utils/error-handler.js";
import * as WorktreeService from "@/services/worktree-service";
import * as GitHubService from "@/services/github-service";
import type { RegisteredTool } from "../types.js";

/**
 * git_validate_repo - Check if a path is a valid git repository
 */
const gitValidateRepo = createTool({
  name: "git_validate_repo",
  description: "Check if a path is a valid git repository.",
  inputSchema: z.object({
    path: z.string().describe("Filesystem path to validate"),
  }),
  handler: async (input) => {
    const isGitRepo = await WorktreeService.isGitRepo(input.path);

    if (!isGitRepo) {
      return successResult({
        success: true,
        isGitRepo: false,
        path: input.path,
      });
    }

    // Get branches if it's a git repo
    const branches = await WorktreeService.getBranches(input.path);

    return successResult({
      success: true,
      isGitRepo: true,
      path: input.path,
      branches: branches.map((b: { name: string; isDefault: boolean; isRemote: boolean }) => ({
        name: b.name,
        isDefault: b.isDefault,
        isRemote: b.isRemote,
      })),
    });
  },
});

/**
 * git_worktree_create - Create a git worktree for branch isolation
 */
const gitWorktreeCreate = createTool({
  name: "git_worktree_create",
  description:
    "Create a git worktree for a branch. Worktrees allow working on multiple branches " +
    "simultaneously in separate directories. Great for feature development.",
  inputSchema: z.object({
    repoPath: z.string().describe("Path to the git repository"),
    branchName: z.string().describe("Name of the branch to create/checkout"),
    createBranch: z
      .boolean()
      .optional()
      .default(true)
      .describe("Create a new branch (default: true)"),
    baseBranch: z
      .string()
      .optional()
      .describe("Base branch for new branch creation"),
    worktreePath: z
      .string()
      .optional()
      .describe("Custom path for the worktree (auto-generated if not specified)"),
  }),
  handler: async (input) => {
    // Validate it's a git repo
    if (!(await WorktreeService.isGitRepo(input.repoPath))) {
      return successResult({
        success: false,
        error: "Path is not a git repository",
        code: "NOT_GIT_REPO",
        path: input.repoPath,
      });
    }

    let worktreePath: string;
    let branch: string;

    if (input.createBranch) {
      // Create new branch with worktree - returns { branch, worktreePath }
      const result = await WorktreeService.createBranchWithWorktree(
        input.repoPath,
        input.branchName,
        input.baseBranch,
        input.worktreePath
      );
      worktreePath = result.worktreePath;
      branch = result.branch;
    } else {
      // Create worktree for existing branch - returns just the path string
      worktreePath = await WorktreeService.createWorktree(
        input.repoPath,
        input.branchName,
        input.worktreePath
      );
      branch = input.branchName;
    }

    // Copy .env files from main repo
    WorktreeService.copyEnvFilesToWorktree(input.repoPath, worktreePath);

    return successResult({
      success: true,
      worktreePath,
      branch,
      hint: "Use session_create with this worktreePath as projectPath to start working.",
    });
  },
});

/**
 * git_worktree_list - List all worktrees for a repository
 */
const gitWorktreeList = createTool({
  name: "git_worktree_list",
  description: "List all git worktrees for a repository.",
  inputSchema: z.object({
    repoPath: z.string().describe("Path to the git repository"),
  }),
  handler: async (input) => {
    if (!(await WorktreeService.isGitRepo(input.repoPath))) {
      return successResult({
        success: false,
        error: "Path is not a git repository",
        code: "NOT_GIT_REPO",
        path: input.repoPath,
      });
    }

    const worktrees = await WorktreeService.listWorktrees(input.repoPath);

    return successResult({
      success: true,
      repoPath: input.repoPath,
      count: worktrees.length,
      worktrees: worktrees.map((w) => ({
        path: w.path,
        branch: w.branch,
        commit: w.commit,
        isLocked: w.isLocked,
        isPrunable: w.isPrunable,
      })),
    });
  },
});

/**
 * git_worktree_status - Check status of a worktree
 */
const gitWorktreeStatus = createTool({
  name: "git_worktree_status",
  description:
    "Check the status of a git worktree (uncommitted changes, unpushed commits).",
  inputSchema: z.object({
    repoPath: z.string().describe("Path to the main git repository"),
    worktreePath: z.string().describe("Path to the worktree"),
  }),
  handler: async (input) => {
    const status = await WorktreeService.getWorktreeStatus(
      input.repoPath,
      input.worktreePath
    );

    return successResult({
      success: true,
      worktreePath: input.worktreePath,
      status: {
        exists: status.exists,
        isRegistered: status.isRegistered,
        branch: status.branch,
        hasUncommittedChanges: status.hasUncommittedChanges,
        hasUntrackedFiles: status.hasUntrackedFiles,
        hasUnpushedCommits: status.hasUnpushedCommits,
        uncommittedFileCount: status.uncommittedFileCount,
        untrackedFileCount: status.untrackedFileCount,
        unpushedCommitCount: status.unpushedCommitCount,
      },
    });
  },
});

/**
 * git_worktree_remove - Remove a git worktree
 */
const gitWorktreeRemove = createTool({
  name: "git_worktree_remove",
  description:
    "Remove a git worktree. Will fail if there are uncommitted changes unless force is true.",
  inputSchema: z.object({
    repoPath: z.string().describe("Path to the main git repository"),
    worktreePath: z.string().describe("Path to the worktree to remove"),
    force: z
      .boolean()
      .optional()
      .default(false)
      .describe("Force removal even with uncommitted changes"),
  }),
  handler: async (input) => {
    const result = await WorktreeService.removeWorktree(
      input.repoPath,
      input.worktreePath,
      input.force
    );

    return successResult({
      success: true,
      worktreePath: input.worktreePath,
      alreadyRemoved: result.alreadyRemoved,
      hadUncommittedChanges: result.hadUncommittedChanges,
      hadUnpushedCommits: result.hadUnpushedCommits,
      message: result.message,
    });
  },
});

/**
 * git_branches - List branches for a repository
 */
const gitBranches = createTool({
  name: "git_branches",
  description: "List all branches (local and remote) for a git repository.",
  inputSchema: z.object({
    repoPath: z.string().describe("Path to the git repository"),
  }),
  handler: async (input) => {
    if (!(await WorktreeService.isGitRepo(input.repoPath))) {
      return successResult({
        success: false,
        error: "Path is not a git repository",
        code: "NOT_GIT_REPO",
        path: input.repoPath,
      });
    }

    const branches = await WorktreeService.getBranches(input.repoPath);

    return successResult({
      success: true,
      repoPath: input.repoPath,
      count: branches.length,
      branches: branches.map((b: { name: string; isDefault: boolean; isRemote: boolean }) => ({
        name: b.name,
        isDefault: b.isDefault,
        isRemote: b.isRemote,
      })),
    });
  },
});

/**
 * github_repos_list - List GitHub repositories
 */
const githubReposList = createTool({
  name: "github_repos_list",
  description:
    "List GitHub repositories accessible to the user. Requires GitHub to be connected.",
  inputSchema: z.object({
    cached: z
      .boolean()
      .optional()
      .default(false)
      .describe("Only return locally cloned repositories"),
    page: z.number().int().positive().optional().default(1),
    perPage: z.number().int().positive().max(100).optional().default(30),
  }),
  handler: async (input, context) => {
    if (input.cached) {
      // Return only cached/cloned repos
      const repos = await GitHubService.getCachedRepositories(context.userId);

      return successResult({
        success: true,
        cached: true,
        count: repos.length,
        repositories: repos.map((r) => ({
          id: r.id,
          name: r.name,
          fullName: r.fullName,
          localPath: r.localPath,
          cloneUrl: r.cloneUrl,
        })),
      });
    }

    // Fetch from GitHub API
    const token = await GitHubService.getAccessToken(context.userId);

    if (!token) {
      return successResult({
        success: false,
        error: "GitHub not connected",
        code: "GITHUB_NOT_CONNECTED",
        hint: "Connect GitHub account in Remote Dev settings.",
      });
    }

    const repos = await GitHubService.listRepositoriesFromAPI(
      token,
      input.page,
      input.perPage
    );

    return successResult({
      success: true,
      cached: false,
      page: input.page,
      count: repos.length,
      // Indicate if there might be more pages (if we got a full page)
      hasMore: repos.length === input.perPage,
      repositories: repos.map((r: { id: number; name: string; full_name: string; description: string | null; language: string | null; default_branch: string; private: boolean; clone_url: string }) => ({
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        description: r.description,
        language: r.language,
        defaultBranch: r.default_branch,
        isPrivate: r.private,
        cloneUrl: r.clone_url,
      })),
    });
  },
});

/**
 * github_clone - Clone a GitHub repository
 */
const githubClone = createTool({
  name: "github_clone",
  description:
    "Clone a GitHub repository to the local machine. " +
    "Repositories are cloned to ~/.remote-dev/repos/ by default.",
  inputSchema: z.object({
    repoFullName: z
      .string()
      .describe("Full repository name (e.g., 'owner/repo')"),
    targetPath: z
      .string()
      .optional()
      .describe("Custom clone destination (default: ~/.remote-dev/repos/)"),
  }),
  handler: async (input, context) => {
    const token = await GitHubService.getAccessToken(context.userId);

    if (!token) {
      return successResult({
        success: false,
        error: "GitHub not connected",
        code: "GITHUB_NOT_CONNECTED",
        hint: "Connect GitHub account in Remote Dev settings.",
      });
    }

    const result = await GitHubService.cloneRepository(
      token,
      input.repoFullName,
      input.targetPath
    );

    if (!result.success) {
      return successResult({
        success: false,
        error: result.error || "Clone failed",
        code: "CLONE_FAILED",
      });
    }

    return successResult({
      success: true,
      localPath: result.localPath,
      hint: "Use git_worktree_create to create a feature branch worktree.",
    });
  },
});

/**
 * github_issues - List issues from a GitHub repository
 */
const githubIssues = createTool({
  name: "github_issues",
  description:
    "List issues from a GitHub repository. Useful for finding work items to tackle.",
  inputSchema: z.object({
    repoFullName: z
      .string()
      .describe("Full repository name (e.g., 'owner/repo')"),
    state: z
      .enum(["open", "closed", "all"])
      .optional()
      .default("open")
      .describe("Issue state filter"),
    limit: z.number().int().positive().max(100).optional().default(30),
  }),
  handler: async (input, context) => {
    const token = await GitHubService.getAccessToken(context.userId);

    if (!token) {
      return successResult({
        success: false,
        error: "GitHub not connected",
        code: "GITHUB_NOT_CONNECTED",
      });
    }

    const [owner, repo] = input.repoFullName.split("/");

    const issues = await GitHubService.listIssuesFromAPI(
      token,
      owner,
      repo,
      input.state,
      input.limit
    );

    return successResult({
      success: true,
      repoFullName: input.repoFullName,
      state: input.state,
      count: issues.length,
      issues: issues.map((i) => ({
        number: i.number,
        title: i.title,
        state: i.state,
        labels: i.labels.map((l: { name: string }) => l.name),
        assignees: i.assignees.map((a: { login: string }) => a.login),
        createdAt: i.created_at,
        updatedAt: i.updated_at,
        url: i.html_url,
      })),
    });
  },
});

/**
 * Export all git tools
 */
export const gitTools: RegisteredTool[] = [
  gitValidateRepo,
  gitWorktreeCreate,
  gitWorktreeList,
  gitWorktreeStatus,
  gitWorktreeRemove,
  gitBranches,
  githubReposList,
  githubClone,
  githubIssues,
];
