/**
 * GitHubIssue - Domain entity representing a GitHub issue.
 *
 * This entity encapsulates the business logic for GitHub issue management.
 * It is immutable - state changes return a new GitHubIssue instance.
 *
 * Invariants:
 * - An issue must have a valid repository ID
 * - An issue must have a positive issue number
 * - An issue must have a non-empty title
 * - An issue must have a valid state (open or closed)
 * - An issue must have a valid HTML URL
 */

import { InvalidValueError } from "../errors/DomainError";

export type IssueState = "open" | "closed";

export interface IssueLabel {
  name: string;
  color: string;
}

export interface IssueUser {
  login: string;
  avatarUrl: string;
}

export interface IssueMilestone {
  title: string;
  number: number;
}

export interface GitHubIssueProps {
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
  isNew: boolean; // Changed since last view
  createdAt: Date;
  updatedAt: Date;
  cachedAt: Date;
}

export interface CreateGitHubIssueProps {
  id?: string;
  repositoryId: string;
  number: number;
  title: string;
  state: IssueState;
  body?: string | null;
  htmlUrl: string;
  author?: IssueUser | null;
  labels?: IssueLabel[];
  assignees?: IssueUser[];
  milestone?: IssueMilestone | null;
  comments?: number;
  isNew?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class GitHubIssue {
  private constructor(private readonly props: GitHubIssueProps) {
    this.validateInvariants();
  }

  private validateInvariants(): void {
    if (!this.props.id || typeof this.props.id !== "string") {
      throw new InvalidValueError(
        "GitHubIssue.id",
        this.props.id,
        "Must be a non-empty string"
      );
    }
    if (!this.props.repositoryId || typeof this.props.repositoryId !== "string") {
      throw new InvalidValueError(
        "GitHubIssue.repositoryId",
        this.props.repositoryId,
        "Must be a non-empty string"
      );
    }
    if (typeof this.props.number !== "number" || this.props.number <= 0) {
      throw new InvalidValueError(
        "GitHubIssue.number",
        this.props.number,
        "Must be a positive number"
      );
    }
    if (!this.props.title || typeof this.props.title !== "string") {
      throw new InvalidValueError(
        "GitHubIssue.title",
        this.props.title,
        "Must be a non-empty string"
      );
    }
    if (this.props.state !== "open" && this.props.state !== "closed") {
      throw new InvalidValueError(
        "GitHubIssue.state",
        this.props.state,
        "Must be 'open' or 'closed'"
      );
    }
    if (!this.props.htmlUrl || typeof this.props.htmlUrl !== "string") {
      throw new InvalidValueError(
        "GitHubIssue.htmlUrl",
        this.props.htmlUrl,
        "Must be a non-empty string"
      );
    }
  }

  /**
   * Create a new GitHubIssue from API data.
   */
  static create(props: CreateGitHubIssueProps): GitHubIssue {
    const id = props.id ?? crypto.randomUUID();
    const now = new Date();

    return new GitHubIssue({
      id,
      repositoryId: props.repositoryId,
      number: props.number,
      title: props.title,
      state: props.state,
      body: props.body ?? null,
      htmlUrl: props.htmlUrl,
      author: props.author ?? null,
      labels: props.labels ?? [],
      assignees: props.assignees ?? [],
      milestone: props.milestone ?? null,
      comments: props.comments ?? 0,
      isNew: props.isNew ?? false,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
      cachedAt: now,
    });
  }

  /**
   * Reconstitute a GitHubIssue from persisted data.
   * Used by repositories when loading from database.
   */
  static reconstitute(props: GitHubIssueProps): GitHubIssue {
    return new GitHubIssue(props);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Getters (expose read-only access to properties)
  // ─────────────────────────────────────────────────────────────────────────────

  get id(): string {
    return this.props.id;
  }

  get repositoryId(): string {
    return this.props.repositoryId;
  }

  get number(): number {
    return this.props.number;
  }

  get title(): string {
    return this.props.title;
  }

  get state(): IssueState {
    return this.props.state;
  }

  get body(): string | null {
    return this.props.body;
  }

  get htmlUrl(): string {
    return this.props.htmlUrl;
  }

  get author(): IssueUser | null {
    return this.props.author;
  }

  get labels(): IssueLabel[] {
    return this.props.labels;
  }

  get assignees(): IssueUser[] {
    return this.props.assignees;
  }

  get milestone(): IssueMilestone | null {
    return this.props.milestone;
  }

  get comments(): number {
    return this.props.comments;
  }

  get isNew(): boolean {
    return this.props.isNew;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get cachedAt(): Date {
    return this.props.cachedAt;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Domain Methods (state transitions and business logic)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Mark this issue as seen (clears the isNew flag).
   */
  markAsSeen(): GitHubIssue {
    if (!this.props.isNew) {
      return this; // Already seen, return same instance
    }
    return this.withUpdates({ isNew: false });
  }

  /**
   * Mark this issue as new.
   */
  markAsNew(): GitHubIssue {
    if (this.props.isNew) {
      return this; // Already new, return same instance
    }
    return this.withUpdates({ isNew: true });
  }

  /**
   * Update cached timestamp.
   */
  refreshCache(): GitHubIssue {
    return this.withUpdates({ cachedAt: new Date() });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Query Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /** Check if issue is open */
  isOpen(): boolean {
    return this.props.state === "open";
  }

  /** Check if issue is closed */
  isClosed(): boolean {
    return this.props.state === "closed";
  }

  /** Check if issue has labels */
  hasLabels(): boolean {
    return this.props.labels.length > 0;
  }

  /** Check if issue has assignees */
  hasAssignees(): boolean {
    return this.props.assignees.length > 0;
  }

  /** Check if issue has a milestone */
  hasMilestone(): boolean {
    return this.props.milestone !== null;
  }

  /** Check if issue belongs to the specified repository */
  belongsToRepository(repositoryId: string): boolean {
    return this.props.repositoryId === repositoryId;
  }

  /**
   * Get a truncated body for preview display.
   * @param maxLength Maximum length (default: 200)
   */
  getBodyPreview(maxLength: number = 200): string | null {
    if (!this.props.body) return null;
    if (this.props.body.length <= maxLength) return this.props.body;
    return this.props.body.substring(0, maxLength).trim() + "...";
  }

  /**
   * Generate a suggested branch name for this issue.
   * Format: issue-{number}-{sanitized-title}
   */
  getSuggestedBranchName(): string {
    const sanitizedTitle = this.props.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .substring(0, 50);
    return `issue-${this.props.number}-${sanitizedTitle}`;
  }

  /**
   * Check if this issue equals another by comparing key fields.
   * Ignores cachedAt and isNew for comparison.
   */
  equals(other: GitHubIssue): boolean {
    return (
      this.repositoryId === other.repositoryId &&
      this.number === other.number &&
      this.title === other.title &&
      this.state === other.state &&
      this.body === other.body &&
      this.htmlUrl === other.htmlUrl &&
      this.comments === other.comments &&
      this.updatedAt.getTime() === other.updatedAt.getTime()
    );
  }

  /**
   * Check if this issue has been updated compared to another.
   * Used for change detection.
   */
  hasUpdatedSince(other: GitHubIssue): boolean {
    return this.updatedAt.getTime() > other.updatedAt.getTime();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a new GitHubIssue with updates applied.
   */
  private withUpdates(updates: Partial<GitHubIssueProps>): GitHubIssue {
    return new GitHubIssue({
      ...this.props,
      ...updates,
    });
  }

  /**
   * Convert to plain object for serialization.
   * Used by mappers when persisting to database.
   */
  toPlainObject(): GitHubIssueProps {
    return { ...this.props };
  }
}
