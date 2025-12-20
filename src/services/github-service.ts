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

export class GitHubServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "GitHubServiceError";
  }
}

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
 * Clone a repository to local disk
 */
export async function cloneRepository(
  accessToken: string,
  repoFullName: string,
  localPath?: string
): Promise<CloneResult> {
  const targetPath = localPath ?? getRepoLocalPath(repoFullName);

  // Check if already cloned
  if (existsSync(join(targetPath, ".git"))) {
    // Repository exists, do a fetch instead
    await execFile("git", ["-C", targetPath, "fetch", "--all"]);
    return { success: true, localPath: targetPath };
  }

  // Create parent directory
  const parentDir = join(targetPath, "..");
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  // Clone with authenticated URL
  const cloneUrl = `https://${accessToken}@github.com/${repoFullName}.git`;

  try {
    await execFile("git", ["clone", cloneUrl, targetPath]);
    return { success: true, localPath: targetPath };
  } catch (error) {
    const err = error as Error & { stderr?: string };
    return {
      success: false,
      localPath: targetPath,
      error: err.stderr || err.message,
    };
  }
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
 * Get a repository by ID from the database
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
