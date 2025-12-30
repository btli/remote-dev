/**
 * GitHubIssueGateway - Port interface for GitHub API interactions.
 *
 * This interface abstracts the GitHub API for fetching issues.
 * It returns domain entities (GitHubIssue), not raw API responses.
 * The implementation is responsible for API calls and data transformation.
 */

import type { GitHubIssue, IssueState } from "@/domain/entities/GitHubIssue";

export interface FetchIssuesParams {
  /** Repository ID (internal database ID, not GitHub ID) */
  repositoryId: string;
  /** Repository owner (username or org) */
  owner: string;
  /** Repository name */
  repo: string;
  /** GitHub access token */
  accessToken: string;
  /** Issue state filter */
  state?: IssueState | "all";
  /** Results per page (max 100) */
  perPage?: number;
  /** Page number for pagination */
  page?: number;
}

export interface FetchIssueParams {
  /** Repository ID (internal database ID, not GitHub ID) */
  repositoryId: string;
  /** Repository owner (username or org) */
  owner: string;
  /** Repository name */
  repo: string;
  /** Issue number */
  issueNumber: number;
  /** GitHub access token */
  accessToken: string;
}

export interface GitHubIssueGateway {
  /**
   * Fetch issues from GitHub API.
   * Returns domain entities with repositoryId attached.
   *
   * @param params Fetch parameters including auth and pagination
   * @returns Array of GitHubIssue domain entities
   * @throws GitHubServiceError on API failures
   */
  fetchIssues(params: FetchIssuesParams): Promise<GitHubIssue[]>;

  /**
   * Fetch a single issue by number.
   *
   * @param params Fetch parameters including issue number
   * @returns GitHubIssue domain entity
   * @throws GitHubServiceError if issue not found or API fails
   */
  fetchIssue(params: FetchIssueParams): Promise<GitHubIssue>;

  /**
   * Fetch all issues (handles pagination automatically).
   * Use with caution on repos with many issues.
   *
   * @param params Fetch parameters (page/perPage ignored)
   * @param maxIssues Maximum issues to fetch (default: 500)
   * @returns Array of all GitHubIssue domain entities
   */
  fetchAllIssues(
    params: Omit<FetchIssuesParams, "page" | "perPage">,
    maxIssues?: number
  ): Promise<GitHubIssue[]>;
}
