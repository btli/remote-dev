/**
 * GitHubIssueMapper - Maps between database records and GitHubIssue domain entity.
 *
 * This mapper handles the conversion of:
 * - Database records (from Drizzle queries) → GitHubIssue domain entities
 * - GitHubIssue domain entities → Database record format (for inserts/updates)
 * - JSON serialization for complex fields (labels, assignees, milestone, author)
 */

import {
  GitHubIssue,
  type GitHubIssueProps,
  type IssueLabel,
  type IssueUser,
  type IssueMilestone,
  type IssueState,
} from "@/domain/entities/GitHubIssue";

/**
 * Raw database record type from Drizzle query.
 * This matches the githubIssues schema.
 */
export interface GitHubIssueDbRecord {
  id: string;
  repositoryId: string;
  issueNumber: number;
  title: string;
  state: "open" | "closed";
  body: string | null;
  htmlUrl: string;
  author: string | null; // JSON string
  labels: string; // JSON string
  assignees: string; // JSON string
  milestone: string | null; // JSON string
  comments: number;
  isNew: boolean;
  createdAt: Date | number;
  updatedAt: Date | number;
  cachedAt: Date | number;
}

/**
 * Format for database insert/update operations.
 */
export interface GitHubIssueDbInsert {
  id: string;
  repositoryId: string;
  issueNumber: number;
  title: string;
  state: "open" | "closed";
  body: string | null;
  htmlUrl: string;
  author: string | null;
  labels: string;
  assignees: string;
  milestone: string | null;
  comments: number;
  isNew: boolean;
  createdAt: Date;
  updatedAt: Date;
  cachedAt: Date;
}

export class GitHubIssueMapper {
  /**
   * Convert a database record to a GitHubIssue domain entity.
   */
  static toDomain(record: GitHubIssueDbRecord): GitHubIssue {
    const props: GitHubIssueProps = {
      id: record.id,
      repositoryId: record.repositoryId,
      number: record.issueNumber,
      title: record.title,
      state: record.state as IssueState,
      body: record.body,
      htmlUrl: record.htmlUrl,
      author: parseJson<IssueUser>(record.author),
      labels: parseJson<IssueLabel[]>(record.labels) ?? [],
      assignees: parseJson<IssueUser[]>(record.assignees) ?? [],
      milestone: parseJson<IssueMilestone>(record.milestone),
      comments: record.comments,
      isNew: record.isNew,
      createdAt: toDate(record.createdAt),
      updatedAt: toDate(record.updatedAt),
      cachedAt: toDate(record.cachedAt),
    };

    return GitHubIssue.reconstitute(props);
  }

  /**
   * Convert multiple database records to GitHubIssue domain entities.
   */
  static toDomainMany(records: GitHubIssueDbRecord[]): GitHubIssue[] {
    return records.map((r) => GitHubIssueMapper.toDomain(r));
  }

  /**
   * Convert a GitHubIssue domain entity to database insert format.
   */
  static toPersistence(issue: GitHubIssue): GitHubIssueDbInsert {
    return {
      id: issue.id,
      repositoryId: issue.repositoryId,
      issueNumber: issue.number,
      title: issue.title,
      state: issue.state,
      body: issue.body,
      htmlUrl: issue.htmlUrl,
      author: issue.author ? JSON.stringify(issue.author) : null,
      labels: JSON.stringify(issue.labels),
      assignees: JSON.stringify(issue.assignees),
      milestone: issue.milestone ? JSON.stringify(issue.milestone) : null,
      comments: issue.comments,
      isNew: issue.isNew,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      cachedAt: issue.cachedAt,
    };
  }

  /**
   * Convert a GitHubIssue to API response format.
   */
  static toApiResponse(issue: GitHubIssue): {
    id: string;
    repositoryId: string;
    number: number;
    title: string;
    state: IssueState;
    body: string | null;
    htmlUrl: string;
    author: IssueUser | null;
    labels: IssueLabel[];
    assignees: IssueUser[];
    milestone: IssueMilestone | null;
    comments: number;
    isNew: boolean;
    createdAt: string;
    updatedAt: string;
    cachedAt: string;
    bodyPreview: string | null;
    suggestedBranchName: string;
  } {
    return {
      id: issue.id,
      repositoryId: issue.repositoryId,
      number: issue.number,
      title: issue.title,
      state: issue.state,
      body: issue.body,
      htmlUrl: issue.htmlUrl,
      author: issue.author,
      labels: issue.labels,
      assignees: issue.assignees,
      milestone: issue.milestone,
      comments: issue.comments,
      isNew: issue.isNew,
      createdAt: issue.createdAt.toISOString(),
      updatedAt: issue.updatedAt.toISOString(),
      cachedAt: issue.cachedAt.toISOString(),
      bodyPreview: issue.getBodyPreview(),
      suggestedBranchName: issue.getSuggestedBranchName(),
    };
  }

  /**
   * Convert multiple GitHubIssues to API response format.
   */
  static toApiResponseMany(
    issues: GitHubIssue[]
  ): ReturnType<typeof GitHubIssueMapper.toApiResponse>[] {
    return issues.map((i) => GitHubIssueMapper.toApiResponse(i));
  }
}

/**
 * Helper to parse JSON string or return null.
 */
function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * Helper to convert various timestamp formats to Date.
 */
function toDate(value: Date | number | string): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "number") {
    return new Date(value);
  }
  return new Date(value);
}
