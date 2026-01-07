/**
 * GitHubGraphQLService - Efficient batched GitHub API queries using GraphQL
 * Provides repository stats, PR data, CI status, and branch protection info
 */

import { graphql } from "@octokit/graphql";
import type {
  GraphQLRepositoryStats,
  RepositoryStats,
  PullRequest,
  CIStatus,
  CIStatusState,
  CommitInfo,
  BranchProtection,
} from "@/types/github-stats";
import { GitHubGraphQLError } from "@/lib/errors";

// Re-export for backwards compatibility
export { GitHubGraphQLError };

// GraphQL query for fetching repository stats (batched)
const REPO_STATS_QUERY = `
  query RepositoryStats($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      name
      nameWithOwner
      url
      description
      isPrivate
      defaultBranchRef {
        name
        target {
          ... on Commit {
            oid
            message
            author {
              name
              avatarUrl
            }
            statusCheckRollup {
              state
              contexts(first: 20) {
                totalCount
                nodes {
                  __typename
                  ... on CheckRun {
                    name
                    status
                    conclusion
                  }
                  ... on StatusContext {
                    state
                  }
                }
              }
            }
            history(first: 5) {
              nodes {
                oid
                message
                author {
                  name
                  avatarUrl
                }
                committedDate
                url
              }
            }
          }
        }
        branchProtectionRule {
          requiresApprovingReviews
          requiredApprovingReviewCount
          requiresStatusChecks
          requiredStatusCheckContexts
          allowsForcePushes
          allowsDeletions
        }
      }
      pullRequests(states: OPEN, first: 20, orderBy: {field: UPDATED_AT, direction: DESC}) {
        totalCount
        nodes {
          id
          number
          title
          state
          headRefName
          baseRefName
          isDraft
          additions
          deletions
          reviewDecision
          author {
            login
            avatarUrl
          }
          url
          createdAt
          updatedAt
          commits(last: 1) {
            nodes {
              commit {
                statusCheckRollup {
                  state
                }
              }
            }
          }
        }
      }
      issues(states: OPEN) {
        totalCount
      }
    }
  }
`;

// GraphQL fragment for repository fields (reused by dynamic query builder)
const REPO_FIELDS_FRAGMENT = `
  fragment RepoFields on Repository {
    name
    nameWithOwner
    url
    description
    isPrivate
    defaultBranchRef {
      name
      target {
        ... on Commit {
          oid
          message
          author {
            name
            avatarUrl
          }
          statusCheckRollup {
            state
            contexts(first: 20) {
              totalCount
              nodes {
                __typename
                ... on CheckRun {
                  name
                  status
                  conclusion
                }
                ... on StatusContext {
                  state
                }
              }
            }
          }
          history(first: 5) {
            nodes {
              oid
              message
              author {
                name
                avatarUrl
              }
              committedDate
              url
            }
          }
        }
      }
      branchProtectionRule {
        requiresApprovingReviews
        requiredApprovingReviewCount
        requiresStatusChecks
        requiredStatusCheckContexts
        allowsForcePushes
        allowsDeletions
      }
    }
    pullRequests(states: OPEN, first: 20, orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      nodes {
        id
        number
        title
        state
        headRefName
        baseRefName
        isDraft
        additions
        deletions
        reviewDecision
        author {
          login
          avatarUrl
        }
        url
        createdAt
        updatedAt
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                state
              }
            }
          }
        }
      }
    }
    issues(states: OPEN) {
      totalCount
    }
  }
`;

/**
 * Build a dynamic GraphQL query for the exact number of repos in the batch
 * This avoids padding with fake repos that cause API errors
 */
function buildBatchQuery(count: number): string {
  const params = Array.from({ length: count }, (_, i) =>
    `$repo${i}: String!, $owner${i}: String!`
  ).join(",\n    ");

  const repos = Array.from({ length: count }, (_, i) =>
    `repo${i}: repository(owner: $owner${i}, name: $repo${i}) { ...RepoFields }`
  ).join("\n    ");

  return `
  query BatchRepositoryStats(
    ${params}
  ) {
    ${repos}
  }
  ${REPO_FIELDS_FRAGMENT}`;
}

/**
 * Create authenticated GraphQL client
 */
function createClient(accessToken: string) {
  return graphql.defaults({
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });
}

/**
 * Parse GitHub status check state to our CIStatusState
 */
function parseStatusState(
  state: "SUCCESS" | "FAILURE" | "PENDING" | "ERROR" | "EXPECTED" | undefined
): CIStatusState {
  switch (state) {
    case "SUCCESS":
      return "passing";
    case "FAILURE":
    case "ERROR":
      return "failing";
    case "PENDING":
    case "EXPECTED":
      return "pending";
    default:
      return "unknown";
  }
}

/**
 * Parse CI status from GraphQL response
 */
type StatusCheckRollupType = NonNullable<
  NonNullable<GraphQLRepositoryStats["defaultBranchRef"]>["target"]
>["statusCheckRollup"];

function parseCIStatus(
  statusCheckRollup: StatusCheckRollupType
): CIStatus | null {
  if (!statusCheckRollup) {
    return null;
  }

  const state = parseStatusState(statusCheckRollup.state);
  const contexts = statusCheckRollup.contexts;

  let successCount = 0;
  let failureCount = 0;
  let pendingCount = 0;

  const checkRuns = contexts.nodes.map((node) => {
    if (node.__typename === "CheckRun") {
      const conclusion = node.conclusion as "success" | "failure" | "cancelled" | "skipped" | null;
      const status = node.status as "completed" | "in_progress" | "queued";

      if (conclusion === "success") successCount++;
      else if (conclusion === "failure") failureCount++;
      else if (status !== "completed") pendingCount++;

      return {
        name: node.name ?? "Unknown",
        status,
        conclusion,
      };
    }

    // StatusContext
    const contextState = node.state as "SUCCESS" | "FAILURE" | "PENDING" | "ERROR" | undefined;
    if (contextState === "SUCCESS") successCount++;
    else if (contextState === "FAILURE" || contextState === "ERROR") failureCount++;
    else pendingCount++;

    return {
      name: "Status Check",
      status: "completed" as const,
      conclusion: contextState === "SUCCESS" ? "success" as const : contextState === "FAILURE" ? "failure" as const : null,
    };
  });

  return {
    state,
    checkRuns,
    totalCount: contexts.totalCount,
    successCount,
    failureCount,
    pendingCount,
  };
}

/**
 * Parse branch protection from GraphQL response
 */
type BranchProtectionRuleType = NonNullable<GraphQLRepositoryStats["defaultBranchRef"]>["branchProtectionRule"];

function parseBranchProtection(
  branchName: string,
  rule: BranchProtectionRuleType
): BranchProtection {
  if (!rule) {
    return {
      branch: branchName,
      isProtected: false,
      requiresReview: false,
      requiredReviewers: 0,
      requiresStatusChecks: false,
      requiredChecks: [],
      allowsForcePushes: true,
      allowsDeletions: true,
    };
  }

  return {
    branch: branchName,
    isProtected: true,
    requiresReview: rule.requiresApprovingReviews,
    requiredReviewers: rule.requiredApprovingReviewCount,
    requiresStatusChecks: rule.requiresStatusChecks,
    requiredChecks: rule.requiredStatusCheckContexts,
    allowsForcePushes: rule.allowsForcePushes,
    allowsDeletions: rule.allowsDeletions,
  };
}

/**
 * Parse recent commits from GraphQL response
 */
function parseRecentCommits(
  history: { nodes: Array<{
    oid: string;
    message: string;
    author: { name: string; avatarUrl: string };
    committedDate: string;
    url: string;
  }> } | undefined
): CommitInfo[] {
  if (!history?.nodes) {
    return [];
  }

  return history.nodes.map((commit) => ({
    sha: commit.oid,
    message: commit.message.split("\n")[0], // First line only
    author: commit.author.name,
    authorAvatarUrl: commit.author.avatarUrl,
    committedDate: commit.committedDate,
    url: commit.url,
  }));
}

/**
 * Parse pull requests from GraphQL response
 */
function parsePullRequests(
  prs: GraphQLRepositoryStats["pullRequests"],
  existingPRNumbers: Set<number> = new Set()
): PullRequest[] {
  return prs.nodes.map((pr) => {
    const commitStatus = pr.commits.nodes[0]?.commit?.statusCheckRollup;

    return {
      id: pr.id,
      number: pr.number,
      title: pr.title,
      state: pr.state.toLowerCase() as "open" | "closed" | "merged",
      branch: pr.headRefName,
      baseBranch: pr.baseRefName,
      author: pr.author?.login ?? "unknown",
      authorAvatarUrl: pr.author?.avatarUrl,
      url: pr.url,
      ciStatus: commitStatus
        ? {
            state: parseStatusState(commitStatus.state),
            checkRuns: [],
            totalCount: 0,
            successCount: 0,
            failureCount: 0,
            pendingCount: 0,
          }
        : null,
      isDraft: pr.isDraft,
      isNew: !existingPRNumbers.has(pr.number),
      additions: pr.additions,
      deletions: pr.deletions,
      reviewDecision: pr.reviewDecision,
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
    };
  });
}

/**
 * Fetch stats for a single repository
 */
export async function fetchRepositoryStats(
  accessToken: string,
  owner: string,
  repo: string,
  existingPRNumbers: Set<number> = new Set()
): Promise<{
  stats: RepositoryStats;
  pullRequests: PullRequest[];
  branchProtection: BranchProtection | null;
  recentCommits: CommitInfo[];
}> {
  try {
    const client = createClient(accessToken);

    const response = await client<{ repository: GraphQLRepositoryStats }>(
      REPO_STATS_QUERY,
      { owner, name: repo }
    );

    const data = response.repository;
    const defaultBranchRef = data.defaultBranchRef;
    const branchName = defaultBranchRef?.name ?? "main";

    // Parse CI status from default branch
    const ciStatus = defaultBranchRef?.target?.statusCheckRollup
      ? parseCIStatus(defaultBranchRef.target.statusCheckRollup)
      : null;

    // Parse branch protection
    const branchProtection = parseBranchProtection(
      branchName,
      defaultBranchRef?.branchProtectionRule
    );

    // Parse recent commits
    const recentCommits = parseRecentCommits(
      defaultBranchRef?.target?.history
    );

    // Parse pull requests
    const pullRequests = parsePullRequests(data.pullRequests, existingPRNumbers);

    const stats: RepositoryStats = {
      repositoryId: "", // Will be set by caller
      openPRCount: data.pullRequests.totalCount,
      openIssueCount: data.issues.totalCount,
      ciStatus,
      branchProtection,
      recentCommits,
      lastFetchedAt: new Date(),
    };

    return {
      stats,
      pullRequests,
      branchProtection,
      recentCommits,
    };
  } catch (error) {
    const err = error as Error & { status?: number };
    throw new GitHubGraphQLError(
      `Failed to fetch repository stats: ${err.message}`,
      "GRAPHQL_ERROR",
      err.status
    );
  }
}

/**
 * Fetch stats for multiple repositories in batches
 * Uses batched GraphQL queries to minimize API calls
 */
export interface BatchedStatsResult {
  stats: RepositoryStats;
  pullRequests: PullRequest[];
  branchProtection: BranchProtection | null;
  recentCommits: CommitInfo[];
}

export interface BatchedStatsResponse {
  results: Map<string, BatchedStatsResult>;
  errors: Map<string, Error>;
}

export async function fetchBatchedStats(
  accessToken: string,
  repositories: Array<{ id: string; fullName: string; existingPRNumbers?: Set<number> }>
): Promise<BatchedStatsResponse> {
  const results = new Map<string, BatchedStatsResult>();
  const errors = new Map<string, Error>();

  // Process in batches of 10 (GraphQL query limitation)
  const batchSize = 10;
  const client = createClient(accessToken);

  for (let i = 0; i < repositories.length; i += batchSize) {
    const batch = repositories.slice(i, i + batchSize);

    // Build variables for batched query (no padding needed with dynamic query)
    const variables: Record<string, string> = {};
    for (let j = 0; j < batch.length; j++) {
      const [owner, name] = batch[j].fullName.split("/");
      variables[`owner${j}`] = owner;
      variables[`repo${j}`] = name;
    }

    // Build dynamic query for exact batch size
    const query = buildBatchQuery(batch.length);

    try {
      const response = await client<Record<string, GraphQLRepositoryStats | null>>(
        query,
        variables
      );

      // Process each repo in the batch
      for (let j = 0; j < batch.length; j++) {
        const repo = batch[j];
        const data = response[`repo${j}`];

        if (!data) {
          continue; // Repository not found or error
        }

        const defaultBranchRef = data.defaultBranchRef;
        const branchName = defaultBranchRef?.name ?? "main";

        const ciStatus = defaultBranchRef?.target?.statusCheckRollup
          ? parseCIStatus(defaultBranchRef.target.statusCheckRollup)
          : null;

        const branchProtection = parseBranchProtection(
          branchName,
          defaultBranchRef?.branchProtectionRule
        );

        const recentCommits = parseRecentCommits(
          defaultBranchRef?.target?.history
        );

        const pullRequests = parsePullRequests(
          data.pullRequests,
          repo.existingPRNumbers ?? new Set()
        );

        const stats: RepositoryStats = {
          repositoryId: repo.id,
          openPRCount: data.pullRequests.totalCount,
          openIssueCount: data.issues.totalCount,
          ciStatus,
          branchProtection,
          recentCommits,
          lastFetchedAt: new Date(),
        };

        results.set(repo.id, {
          stats,
          pullRequests,
          branchProtection,
          recentCommits,
        });
      }
    } catch (error) {
      // Track errors for each repo in the failed batch
      const errorObj = error instanceof Error ? error : new Error(String(error));
      console.error(`Error fetching batch starting at ${i}:`, error);

      // Record error for each repository in the failed batch
      for (const repo of batch) {
        errors.set(repo.id, errorObj);
      }
    }
  }

  return { results, errors };
}

/**
 * Fetch PR details for creating a worktree
 */
export async function fetchPRDetails(
  accessToken: string,
  owner: string,
  repo: string,
  prNumber: number
): Promise<{
  branch: string;
  baseBranch: string;
  title: string;
  author: string;
} | null> {
  const query = `
    query PRDetails($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          headRefName
          baseRefName
          title
          author {
            login
          }
        }
      }
    }
  `;

  try {
    const client = createClient(accessToken);
    const response = await client<{
      repository: {
        pullRequest: {
          headRefName: string;
          baseRefName: string;
          title: string;
          author: { login: string } | null;
        } | null;
      };
    }>(query, { owner, repo, number: prNumber });

    const pr = response.repository.pullRequest;
    if (!pr) {
      return null;
    }

    return {
      branch: pr.headRefName,
      baseBranch: pr.baseRefName,
      title: pr.title,
      author: pr.author?.login ?? "unknown",
    };
  } catch (error) {
    console.error(`Error fetching PR #${prNumber}:`, error);
    return null;
  }
}
