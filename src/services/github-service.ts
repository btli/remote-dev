/**
 * GitHubService - Manages GitHub OAuth, repository listing, and cloning
 */
import { db } from "@/db";
import { accounts, githubRepositories } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { execFile } from "@/lib/exec";
import type {
  CachedGitHubRepository,
  GitHubRepoFromAPI,
  GitHubBranch,
  FolderNode,
  CloneResult,
} from "@/types/github";
import { existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { GitHubServiceError } from "@/lib/errors";

// Re-export for backwards compatibility with API routes
export { GitHubServiceError };

const GITHUB_API_BASE = "https://api.github.com";
const REPOS_CACHE_DIR = ".remote-dev/repos";

/**
 * Get the GitHub access token for a user
 */
export async function getAccessToken(userId: string): Promise<string | null> {
  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.userId, userId), eq(accounts.provider, "github")),
  });
  return account?.access_token ?? null;
}

/**
 * Make an authenticated request to the GitHub API
 */
async function githubFetch<T>(
  accessToken: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${GITHUB_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new GitHubServiceError(
      `GitHub API error: ${response.statusText}`,
      "API_ERROR",
      response.status
    );
  }

  return response.json();
}

/**
 * List user's repositories from GitHub API
 */
export async function listRepositoriesFromAPI(
  accessToken: string,
  page = 1,
  perPage = 100,
  sort: "updated" | "created" | "pushed" | "full_name" = "updated"
): Promise<GitHubRepoFromAPI[]> {
  return githubFetch<GitHubRepoFromAPI[]>(
    accessToken,
    `/user/repos?per_page=${perPage}&page=${page}&sort=${sort}&affiliation=owner,collaborator,organization_member`
  );
}

/**
 * Get a single repository from GitHub API
 */
export async function getRepositoryFromAPI(
  accessToken: string,
  owner: string,
  repo: string
): Promise<GitHubRepoFromAPI> {
  return githubFetch<GitHubRepoFromAPI>(accessToken, `/repos/${owner}/${repo}`);
}

/**
 * List branches for a repository
 */
export async function listBranchesFromAPI(
  accessToken: string,
  owner: string,
  repo: string
): Promise<GitHubBranch[]> {
  return githubFetch<GitHubBranch[]>(
    accessToken,
    `/repos/${owner}/${repo}/branches?per_page=100`
  );
}

/**
 * GitHub Issue type for Agent API
 */
export interface GitHubIssue {
  number: number;
  title: string;
  state: "open" | "closed";
  body: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  user: {
    login: string;
    avatar_url: string;
  } | null;
  labels: Array<{ name: string; color: string }>;
  assignees: Array<{ login: string; avatar_url: string }>;
  milestone: {
    title: string;
    number: number;
  } | null;
  comments: number;
}

/**
 * List issues for a repository
 *
 * This is useful for the Agent API orchestrator workflow where an agent
 * reviews issues and creates worktree sessions to address each one.
 *
 * @param accessToken - GitHub access token
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param state - Issue state filter (default: "open")
 * @param perPage - Number of issues per page (default: 100)
 * @param page - Page number (default: 1)
 */
export async function listIssuesFromAPI(
  accessToken: string,
  owner: string,
  repo: string,
  state: "open" | "closed" | "all" = "open",
  perPage: number = 100,
  page: number = 1
): Promise<GitHubIssue[]> {
  return githubFetch<GitHubIssue[]>(
    accessToken,
    `/repos/${owner}/${repo}/issues?state=${state}&per_page=${perPage}&page=${page}&sort=updated&direction=desc`
  );
}

/**
 * Get a single issue by number
 */
export async function getIssueFromAPI(
  accessToken: string,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<GitHubIssue> {
  return githubFetch<GitHubIssue>(
    accessToken,
    `/repos/${owner}/${repo}/issues/${issueNumber}`
  );
}

/**
 * Get cached repositories for a user from the database
 */
export async function getCachedRepositories(
  userId: string
): Promise<CachedGitHubRepository[]> {
  const repos = await db.query.githubRepositories.findMany({
    where: eq(githubRepositories.userId, userId),
  });
  return repos.map(mapDbRepoToCachedRepository);
}

/**
 * Cache a repository in the database
 */
export async function cacheRepository(
  userId: string,
  repo: GitHubRepoFromAPI
): Promise<CachedGitHubRepository> {
  const existing = await db.query.githubRepositories.findFirst({
    where: and(
      eq(githubRepositories.userId, userId),
      eq(githubRepositories.githubId, repo.id)
    ),
  });

  if (existing) {
    // Update existing record
    const [updated] = await db
      .update(githubRepositories)
      .set({
        name: repo.name,
        fullName: repo.full_name,
        cloneUrl: repo.clone_url,
        defaultBranch: repo.default_branch,
        isPrivate: repo.private,
        updatedAt: new Date(),
      })
      .where(eq(githubRepositories.id, existing.id))
      .returning();
    return mapDbRepoToCachedRepository(updated);
  }

  // Insert new record
  const [inserted] = await db
    .insert(githubRepositories)
    .values({
      userId,
      githubId: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      cloneUrl: repo.clone_url,
      defaultBranch: repo.default_branch,
      isPrivate: repo.private,
    })
    .returning();

  return mapDbRepoToCachedRepository(inserted);
}

/**
 * Get the base directory for cloned repositories
 */
export function getReposBaseDir(): string {
  return join(process.env.HOME ?? "/tmp", REPOS_CACHE_DIR);
}

/**
 * Get the local path for a repository
 */
export function getRepoLocalPath(repoFullName: string): string {
  const [owner, repo] = repoFullName.split("/");
  return join(getReposBaseDir(), owner, repo);
}

/**
 * Clone a repository to local disk.
 * SECURITY: Uses GIT_ASKPASS to provide credentials securely without exposing
 * the token in process arguments or error messages.
 */
export async function cloneRepository(
  accessToken: string,
  repoFullName: string,
  localPath?: string
): Promise<CloneResult> {
  const targetPath = localPath ?? getRepoLocalPath(repoFullName);

  // Check if already cloned
  if (existsSync(join(targetPath, ".git"))) {
    // Repository exists, do a fetch instead using credential helper
    try {
      await execFileWithToken(accessToken, "git", ["-C", targetPath, "fetch", "--all"]);
      return { success: true, localPath: targetPath };
    } catch (error) {
      const err = error as Error & { stderr?: string };
      return {
        success: false,
        localPath: targetPath,
        error: sanitizeGitError(err.stderr || err.message),
      };
    }
  }

  // Create parent directory
  const parentDir = join(targetPath, "..");
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  // SECURITY: Clone using HTTPS URL without embedded token
  // Token is provided via GIT_ASKPASS environment variable
  const cloneUrl = `https://github.com/${repoFullName}.git`;

  try {
    await execFileWithToken(accessToken, "git", ["clone", cloneUrl, targetPath]);
    return { success: true, localPath: targetPath };
  } catch (error) {
    const err = error as Error & { stderr?: string };
    return {
      success: false,
      localPath: targetPath,
      error: sanitizeGitError(err.stderr || err.message),
    };
  }
}

/**
 * Execute a git command with token authentication via GIT_ASKPASS.
 * This prevents the token from appearing in process arguments.
 */
async function execFileWithToken(
  accessToken: string,
  command: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  const { writeFileSync, unlinkSync, chmodSync } = await import("fs");
  const { tmpdir } = await import("os");
  const { join: pathJoin } = await import("path");

  // Create a temporary script that echoes the token
  const scriptPath = pathJoin(tmpdir(), `git-askpass-${Date.now()}.sh`);
  writeFileSync(scriptPath, `#!/bin/sh\necho "${accessToken}"\n`);
  chmodSync(scriptPath, 0o700);

  try {
    const result = await execFile(command, args, {
      env: {
        ...process.env,
        GIT_ASKPASS: scriptPath,
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    return result;
  } finally {
    // Clean up the temporary script
    try {
      unlinkSync(scriptPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Sanitize git error messages to remove any potential token leakage.
 */
function sanitizeGitError(message: string): string {
  // Remove any URLs that might contain tokens
  return message
    .replace(/https:\/\/[^@]*@github\.com/g, "https://github.com")
    .replace(/x-access-token:[^@]*@/g, "")
    .replace(/ghp_[a-zA-Z0-9]+/g, "[REDACTED]")
    .replace(/gho_[a-zA-Z0-9]+/g, "[REDACTED]");
}

/**
 * Update the local path in the database after cloning
 */
export async function updateLocalPath(
  repoId: string,
  localPath: string
): Promise<void> {
  await db
    .update(githubRepositories)
    .set({ localPath, updatedAt: new Date() })
    .where(eq(githubRepositories.id, repoId));
}

/**
 * Get a repository by internal database ID
 */
export async function getRepository(
  repoId: string,
  userId: string
): Promise<CachedGitHubRepository | null> {
  const repo = await db.query.githubRepositories.findFirst({
    where: and(
      eq(githubRepositories.id, repoId),
      eq(githubRepositories.userId, userId)
    ),
  });
  return repo ? mapDbRepoToCachedRepository(repo) : null;
}

/**
 * Get a repository by GitHub ID from the database
 */
export async function getRepositoryByGitHubId(
  githubId: number,
  userId: string
): Promise<CachedGitHubRepository | null> {
  const repo = await db.query.githubRepositories.findFirst({
    where: and(
      eq(githubRepositories.githubId, githubId),
      eq(githubRepositories.userId, userId)
    ),
  });
  return repo ? mapDbRepoToCachedRepository(repo) : null;
}

/**
 * Get the folder structure of a cloned repository
 */
export function getFolderStructure(
  localPath: string,
  maxDepth = 3
): FolderNode[] {
  if (!existsSync(localPath)) {
    return [];
  }

  function readDir(path: string, depth: number): FolderNode[] {
    if (depth > maxDepth) {
      return [];
    }

    try {
      const entries = readdirSync(path);
      const nodes: FolderNode[] = [];

      for (const entry of entries) {
        // Skip hidden files and common non-relevant directories
        if (
          entry.startsWith(".") ||
          entry === "node_modules" ||
          entry === "__pycache__" ||
          entry === "venv" ||
          entry === ".venv"
        ) {
          continue;
        }

        const fullPath = join(path, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          nodes.push({
            name: entry,
            path: fullPath,
            type: "directory",
            children: readDir(fullPath, depth + 1),
          });
        }
      }

      return nodes.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  return readDir(localPath, 0);
}

/**
 * Check if user has GitHub connected
 */
export async function isGitHubConnected(userId: string): Promise<boolean> {
  const token = await getAccessToken(userId);
  return token !== null;
}

/**
 * Validate GitHub token is still valid
 */
export async function validateToken(accessToken: string): Promise<boolean> {
  try {
    await githubFetch(accessToken, "/user");
    return true;
  } catch {
    return false;
  }
}

// Helper to map database result to TypeScript type
function mapDbRepoToCachedRepository(
  dbRepo: typeof githubRepositories.$inferSelect
): CachedGitHubRepository {
  return {
    id: dbRepo.id,
    userId: dbRepo.userId,
    githubId: dbRepo.githubId,
    name: dbRepo.name,
    fullName: dbRepo.fullName,
    cloneUrl: dbRepo.cloneUrl,
    defaultBranch: dbRepo.defaultBranch,
    localPath: dbRepo.localPath,
    isPrivate: dbRepo.isPrivate ?? false,
    addedAt: new Date(dbRepo.addedAt),
    updatedAt: new Date(dbRepo.updatedAt),
  };
}
