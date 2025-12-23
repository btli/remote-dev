/**
 * GitHub Stats Types for enhanced GitHub integration
 * Supports PR counts, issue counts, CI status, branch protection, and recent commits
 */

// =============================================================================
// Core Stats Types
// =============================================================================

export type CIStatusState = "passing" | "failing" | "pending" | "unknown";

export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  authorAvatarUrl?: string;
  committedDate: string;
  url: string;
}

export interface CheckRun {
  name: string;
  status: "completed" | "in_progress" | "queued";
  conclusion: "success" | "failure" | "cancelled" | "skipped" | null;
}

export interface CIStatus {
  state: CIStatusState;
  checkRuns: CheckRun[];
  totalCount: number;
  successCount: number;
  failureCount: number;
  pendingCount: number;
}

export interface BranchProtection {
  branch: string;
  isProtected: boolean;
  requiresReview: boolean;
  requiredReviewers: number;
  requiresStatusChecks: boolean;
  requiredChecks: string[];
  allowsForcePushes: boolean;
  allowsDeletions: boolean;
}

export interface RepositoryStats {
  repositoryId: string;
  openPRCount: number;
  openIssueCount: number;
  ciStatus: CIStatus | null;
  branchProtection: BranchProtection | null;
  recentCommits: CommitInfo[];
  lastFetchedAt: Date | null;
}

// =============================================================================
// Pull Request Types
// =============================================================================

export type PRState = "open" | "closed" | "merged";

export interface PullRequest {
  id: string;
  number: number;
  title: string;
  state: PRState;
  branch: string;
  baseBranch: string;
  author: string;
  authorAvatarUrl?: string;
  url: string;
  ciStatus: CIStatus | null;
  isDraft: boolean;
  isNew: boolean; // Changed since last refresh
  additions: number;
  deletions: number;
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Repository Enhancement Types
// =============================================================================

export interface EnrichedRepository {
  id: string;
  name: string;
  fullName: string;
  owner: string;
  url: string;
  description: string | null;
  defaultBranch: string;
  localPath: string | null;
  isPrivate: boolean;
  isCloned: boolean;
  stats: RepositoryStats;
  pullRequests: PullRequest[];
  hasChanges: boolean; // New PRs/issues since last view
  changeCount: number;
}

// =============================================================================
// Configuration Constants
// =============================================================================

/**
 * Default TTL for GitHub stats cache in minutes.
 * This is the single source of truth for cache expiration time.
 * Used by both client (polling interval) and server (cache TTL).
 */
export const GITHUB_STATS_TTL_MINUTES = 15;

// =============================================================================
// Folder Stats Types
// =============================================================================

/**
 * FolderStats uses a discriminated union to ensure type safety:
 * - If repositoryId is present, repository must also be present
 * - If no repository is linked, both are null
 */
export type FolderStats = FolderStatsBase & (
  | { repositoryId: string; repository: EnrichedRepository }
  | { repositoryId: null; repository: null }
);

interface FolderStatsBase {
  folderId: string;
  // Aggregated display stats for the folder
  prCount: number;
  issueCount: number;
  ciStatus: CIStatusState | null;
  hasChanges: boolean;
}

// =============================================================================
// Preferences Types
// =============================================================================

export interface GitHubStatsDisplayPreferences {
  showPRCount: boolean;
  showIssueCount: boolean;
  showCIStatus: boolean;
  showRecentCommits: boolean;
  showBranchProtection: boolean;
}

export interface GitHubStatsPreferences extends GitHubStatsDisplayPreferences {
  userId: string;
  folderId?: string;
  refreshIntervalMinutes: number;
}

// =============================================================================
// API Response Types
// =============================================================================

export interface RefreshResult {
  success: boolean;
  updatedRepos: string[];
  newPRCount: number;
  closedPRCount: number;
  newIssueCount: number;
  closedIssueCount: number;
  errors: string[];
  timestamp: Date;
}

export interface StatsRefreshResponse {
  repositories: EnrichedRepository[];
  result: RefreshResult;
}

export interface PRWorktreeRequest {
  repositoryId: string;
  prNumber: number;
  sessionName?: string;
  folderId?: string;
}

export interface PRWorktreeResponse {
  success: boolean;
  sessionId: string;
  worktreePath: string;
  branch: string;
  error?: string;
}

// =============================================================================
// GraphQL Query Types (matches GitHub API response shapes)
// =============================================================================

export interface GraphQLRepositoryStats {
  name: string;
  nameWithOwner: string;
  url: string;
  description: string | null;
  isPrivate: boolean;
  defaultBranchRef: {
    name: string;
    target: {
      oid: string;
      message?: string;
      author?: {
        name: string;
        avatarUrl: string;
      };
      statusCheckRollup?: {
        state: "SUCCESS" | "FAILURE" | "PENDING" | "ERROR" | "EXPECTED";
        contexts: {
          totalCount: number;
          nodes: Array<{
            __typename: string;
            name?: string;
            status?: string;
            conclusion?: string;
            state?: string;
          }>;
        };
      };
      history?: {
        nodes: Array<{
          oid: string;
          message: string;
          author: {
            name: string;
            avatarUrl: string;
          };
          committedDate: string;
          url: string;
        }>;
      };
    };
    branchProtectionRule?: {
      requiresApprovingReviews: boolean;
      requiredApprovingReviewCount: number;
      requiresStatusChecks: boolean;
      requiredStatusCheckContexts: string[];
      allowsForcePushes: boolean;
      allowsDeletions: boolean;
    };
  } | null;
  pullRequests: {
    totalCount: number;
    nodes: Array<{
      id: string;
      number: number;
      title: string;
      state: "OPEN" | "CLOSED" | "MERGED";
      headRefName: string;
      baseRefName: string;
      isDraft: boolean;
      additions: number;
      deletions: number;
      reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
      author: {
        login: string;
        avatarUrl: string;
      } | null;
      url: string;
      createdAt: string;
      updatedAt: string;
      commits: {
        nodes: Array<{
          commit: {
            statusCheckRollup?: {
              state: "SUCCESS" | "FAILURE" | "PENDING" | "ERROR" | "EXPECTED";
            };
          };
        }>;
      };
    }>;
  };
  issues: {
    totalCount: number;
  };
}

export interface GraphQLBatchResponse {
  nodes: Array<GraphQLRepositoryStats | null>;
}

// =============================================================================
// Cache Types
// =============================================================================

export interface CachedData<T> {
  data: T;
  cachedAt: Date;
  expiresAt: Date;
}

export interface CacheMetadata {
  key: string;
  cachedAt: Date;
  expiresAt: Date;
  isStale: boolean;
}
