/**
 * GitHubAccountService - Manages GitHub account operations
 *
 * Handles account info fetching, disk usage calculation, disconnection,
 * and repository synchronization.
 */
import { db } from "@/db";
import { accounts, githubRepositories } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { existsSync, readdirSync, statSync, rmSync } from "fs";
import { join } from "path";
import * as GitHubService from "./github-service";

const GITHUB_API_BASE = "https://api.github.com";

/**
 * GitHub account information
 */
export interface GitHubAccountInfo {
  login: string;
  name: string | null;
  avatarUrl: string;
  email: string | null;
  bio: string | null;
  publicRepos: number;
  followers: number;
  following: number;
}

/**
 * Repository with calculated stats
 */
export interface CachedRepositoryWithStats {
  id: string;
  name: string;
  fullName: string;
  isPrivate: boolean;
  localPath: string | null;
  defaultBranch: string;
  cloneUrl: string;
  lastUpdated: Date;
  diskSize: number | null; // bytes, null if not cloned
  cloneStatus: "not_cloned" | "cloned";
}

/**
 * Account statistics
 */
export interface GitHubAccountStats {
  totalRepos: number;
  clonedRepos: number;
  totalDiskSize: number; // bytes
  lastSync: Date | null;
}

/**
 * GitHub API user response type
 */
interface GitHubUserResponse {
  login: string;
  name: string | null;
  avatar_url: string;
  email: string | null;
  bio: string | null;
  public_repos: number;
  followers: number;
  following: number;
}

/**
 * Fetch GitHub account info for authenticated user
 */
export async function getAccountInfo(
  accessToken: string
): Promise<GitHubAccountInfo> {
  const response = await fetch(`${GITHUB_API_BASE}/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch GitHub user info: ${response.statusText}`);
  }

  const data: GitHubUserResponse = await response.json();

  return {
    login: data.login,
    name: data.name,
    avatarUrl: data.avatar_url,
    email: data.email,
    bio: data.bio,
    publicRepos: data.public_repos,
    followers: data.followers,
    following: data.following,
  };
}

/**
 * Calculate disk usage for a directory recursively
 */
export function calculateDirectorySize(dirPath: string): number {
  if (!existsSync(dirPath)) return 0;

  let totalSize = 0;

  const walkDir = (currentPath: string) => {
    try {
      const entries = readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(currentPath, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.isFile()) {
          try {
            const stat = statSync(fullPath);
            totalSize += stat.size;
          } catch {
            // Skip files we can't stat
          }
        }
      }
    } catch {
      // Skip directories we can't read
    }
  };

  walkDir(dirPath);
  return totalSize;
}

/**
 * Get disk size for a cloned repository
 */
export function getRepositoryDiskSize(localPath: string): number {
  return calculateDirectorySize(localPath);
}

/**
 * Disconnect GitHub by removing OAuth account record
 * Optionally clears cached repositories
 */
export async function disconnectGitHub(
  userId: string,
  clearCache: boolean = false
): Promise<void> {
  // Delete the OAuth account
  await db
    .delete(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "github")));

  // Optionally clear cached repositories
  if (clearCache) {
    await clearAllRepositoryCache(userId, false);
  }
}

/**
 * Clear all cached repositories for a user
 */
export async function clearAllRepositoryCache(
  userId: string,
  removeLocalFiles: boolean = false
): Promise<void> {
  // Get all repos to potentially remove local files
  if (removeLocalFiles) {
    const repos = await db.query.githubRepositories.findMany({
      where: eq(githubRepositories.userId, userId),
    });

    for (const repo of repos) {
      if (repo.localPath && existsSync(repo.localPath)) {
        try {
          rmSync(repo.localPath, { recursive: true, force: true });
        } catch {
          // Continue even if we can't delete some files
        }
      }
    }
  }

  // Delete from database
  await db
    .delete(githubRepositories)
    .where(eq(githubRepositories.userId, userId));
}

/**
 * Delete a single repository from cache
 */
export async function deleteRepositoryCache(
  repoId: string,
  userId: string,
  removeLocalFiles: boolean = false
): Promise<void> {
  // Get repo to potentially remove local files
  const repo = await db.query.githubRepositories.findFirst({
    where: and(
      eq(githubRepositories.id, repoId),
      eq(githubRepositories.userId, userId)
    ),
  });

  if (!repo) {
    throw new Error("Repository not found");
  }

  // Remove local files if requested
  if (removeLocalFiles && repo.localPath && existsSync(repo.localPath)) {
    try {
      rmSync(repo.localPath, { recursive: true, force: true });
    } catch {
      // Continue even if we can't delete files
    }
  }

  // Delete from database
  await db.delete(githubRepositories).where(eq(githubRepositories.id, repoId));
}

/**
 * Sync all repositories from GitHub API and update cache
 */
export async function syncAllRepositories(
  userId: string,
  accessToken: string
): Promise<CachedRepositoryWithStats[]> {
  // Fetch all repos from GitHub API (paginated)
  const allRepos = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const repos = await GitHubService.listRepositoriesFromAPI(
      accessToken,
      page,
      perPage,
      "updated"
    );

    if (repos.length === 0) break;

    allRepos.push(...repos);

    if (repos.length < perPage) break;
    page++;
  }

  // Cache all repos and get updated versions
  const cachedRepos = await Promise.all(
    allRepos.map((repo) => GitHubService.cacheRepository(userId, repo))
  );

  // Build stats for each repo
  return cachedRepos.map((repo) => ({
    id: repo.id,
    name: repo.name,
    fullName: repo.fullName,
    isPrivate: repo.isPrivate,
    localPath: repo.localPath,
    defaultBranch: repo.defaultBranch,
    cloneUrl: repo.cloneUrl,
    lastUpdated: repo.updatedAt,
    diskSize: repo.localPath ? getRepositoryDiskSize(repo.localPath) : null,
    cloneStatus: repo.localPath ? "cloned" : "not_cloned",
  }));
}

/**
 * Get all cached repositories with stats for a user
 */
export async function getCachedRepositoriesWithStats(
  userId: string
): Promise<CachedRepositoryWithStats[]> {
  const repos = await GitHubService.getCachedRepositories(userId);

  return repos.map((repo) => ({
    id: repo.id,
    name: repo.name,
    fullName: repo.fullName,
    isPrivate: repo.isPrivate,
    localPath: repo.localPath,
    defaultBranch: repo.defaultBranch,
    cloneUrl: repo.cloneUrl,
    lastUpdated: repo.updatedAt,
    diskSize: repo.localPath ? getRepositoryDiskSize(repo.localPath) : null,
    cloneStatus: repo.localPath ? "cloned" : "not_cloned",
  }));
}

/**
 * Calculate total disk usage across all cloned repos
 */
export async function calculateTotalDiskUsage(userId: string): Promise<number> {
  const repos = await GitHubService.getCachedRepositories(userId);
  let totalSize = 0;

  for (const repo of repos) {
    if (repo.localPath) {
      totalSize += getRepositoryDiskSize(repo.localPath);
    }
  }

  return totalSize;
}

/**
 * Get account stats for a user
 */
export async function getAccountStats(
  userId: string
): Promise<GitHubAccountStats> {
  const repos = await GitHubService.getCachedRepositories(userId);

  const clonedRepos = repos.filter((r) => r.localPath !== null);
  let totalDiskSize = 0;

  for (const repo of clonedRepos) {
    if (repo.localPath) {
      totalDiskSize += getRepositoryDiskSize(repo.localPath);
    }
  }

  // Find most recent update time
  const lastSync =
    repos.length > 0
      ? repos.reduce(
          (latest, repo) =>
            repo.updatedAt > latest ? repo.updatedAt : latest,
          repos[0].updatedAt
        )
      : null;

  return {
    totalRepos: repos.length,
    clonedRepos: clonedRepos.length,
    totalDiskSize,
    lastSync,
  };
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
}
