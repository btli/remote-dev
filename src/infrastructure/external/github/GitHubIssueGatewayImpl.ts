/**
 * GitHubIssueGatewayImpl - Implementation of GitHubIssueGateway
 *
 * This gateway wraps the existing GitHubService functions and transforms
 * API responses into domain entities.
 */

import { GitHubIssue } from "@/domain/entities/GitHubIssue";
import type {
  GitHubIssueGateway,
  FetchIssuesParams,
  FetchIssueParams,
} from "@/application/ports/GitHubIssueGateway";
import {
  listIssuesFromAPI,
  getIssueFromAPI,
  type GitHubIssue as GitHubIssueAPI,
} from "@/services/github-service";

export class GitHubIssueGatewayImpl implements GitHubIssueGateway {
  /**
   * Fetch issues from GitHub API and transform to domain entities.
   */
  async fetchIssues(params: FetchIssuesParams): Promise<GitHubIssue[]> {
    const state =
      params.state === "all" ? "all" : params.state === "closed" ? "closed" : "open";

    const apiIssues = await listIssuesFromAPI(
      params.accessToken,
      params.owner,
      params.repo,
      state,
      params.perPage ?? 100,
      params.page ?? 1
    );

    return apiIssues.map((apiIssue) =>
      this.transformApiIssue(apiIssue, params.repositoryId)
    );
  }

  /**
   * Fetch a single issue by number.
   */
  async fetchIssue(params: FetchIssueParams): Promise<GitHubIssue> {
    const apiIssue = await getIssueFromAPI(
      params.accessToken,
      params.owner,
      params.repo,
      params.issueNumber
    );

    return this.transformApiIssue(apiIssue, params.repositoryId);
  }

  /**
   * Fetch all issues (handles pagination automatically).
   */
  async fetchAllIssues(
    params: Omit<FetchIssuesParams, "page" | "perPage">,
    maxIssues: number = 500
  ): Promise<GitHubIssue[]> {
    const allIssues: GitHubIssue[] = [];
    let page = 1;
    const perPage = 100;

    while (allIssues.length < maxIssues) {
      const issues = await this.fetchIssues({
        ...params,
        page,
        perPage,
      });

      allIssues.push(...issues);

      // If we got fewer than perPage, we've reached the end
      if (issues.length < perPage) {
        break;
      }

      page++;
    }

    return allIssues.slice(0, maxIssues);
  }

  /**
   * Transform a GitHub API issue response to a domain entity.
   */
  private transformApiIssue(
    apiIssue: GitHubIssueAPI,
    repositoryId: string
  ): GitHubIssue {
    return GitHubIssue.create({
      repositoryId,
      number: apiIssue.number,
      title: apiIssue.title,
      state: apiIssue.state,
      body: apiIssue.body,
      htmlUrl: apiIssue.html_url,
      author: apiIssue.user
        ? {
            login: apiIssue.user.login,
            avatarUrl: apiIssue.user.avatar_url,
          }
        : null,
      labels: apiIssue.labels.map((label) => ({
        name: label.name,
        color: label.color,
      })),
      assignees: apiIssue.assignees.map((assignee) => ({
        login: assignee.login,
        avatarUrl: assignee.avatar_url,
      })),
      milestone: apiIssue.milestone
        ? {
            title: apiIssue.milestone.title,
            number: apiIssue.milestone.number,
          }
        : null,
      comments: apiIssue.comments,
      isNew: false, // Will be set by the use case based on comparison
      createdAt: new Date(apiIssue.created_at),
      updatedAt: new Date(apiIssue.updated_at),
    });
  }
}
