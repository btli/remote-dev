/**
 * GitHubAccount - Domain entity representing a linked GitHub account.
 *
 * This entity encapsulates metadata about a GitHub OAuth account linked to a user.
 * It is immutable - state changes return a new GitHubAccount instance.
 *
 * Invariants:
 * - A GitHubAccount must have a valid providerAccountId
 * - A GitHubAccount must have a valid userId
 * - A GitHubAccount must have a login (GitHub username)
 * - Only one account per user can be the default
 */

import { GitHubAccountId } from "../value-objects/GitHubAccountId";
import { InvalidValueError } from "../errors/DomainError";

export interface GitHubAccountProps {
  id: GitHubAccountId;
  userId: string;
  login: string;
  displayName: string | null;
  avatarUrl: string;
  email: string | null;
  isDefault: boolean;
  configDir: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateGitHubAccountProps {
  providerAccountId: string;
  userId: string;
  login: string;
  displayName?: string | null;
  avatarUrl: string;
  email?: string | null;
  isDefault?: boolean;
  configDir: string;
}

export class GitHubAccount {
  private constructor(private readonly props: GitHubAccountProps) {
    this.validateInvariants();
  }

  private validateInvariants(): void {
    if (!this.props.userId) {
      throw new InvalidValueError("GitHubAccount.userId", this.props.userId, "Must be a non-empty string");
    }
    if (!this.props.login) {
      throw new InvalidValueError("GitHubAccount.login", this.props.login, "Must be a non-empty string");
    }
    if (!this.props.configDir?.startsWith("/")) {
      throw new InvalidValueError("GitHubAccount.configDir", this.props.configDir, "Must be an absolute path");
    }
  }

  static create(props: CreateGitHubAccountProps): GitHubAccount {
    const now = new Date();
    return new GitHubAccount({
      id: GitHubAccountId.create(props.providerAccountId),
      userId: props.userId,
      login: props.login,
      displayName: props.displayName ?? null,
      avatarUrl: props.avatarUrl,
      email: props.email ?? null,
      isDefault: props.isDefault ?? false,
      configDir: props.configDir,
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstitute(props: GitHubAccountProps): GitHubAccount {
    return new GitHubAccount(props);
  }

  // -- Domain Methods --

  setAsDefault(): GitHubAccount {
    if (this.props.isDefault) return this;
    return this.withUpdates({ isDefault: true });
  }

  clearDefault(): GitHubAccount {
    if (!this.props.isDefault) return this;
    return this.withUpdates({ isDefault: false });
  }

  updateMetadata(
    login: string,
    displayName: string | null,
    avatarUrl: string,
    email: string | null
  ): GitHubAccount {
    return this.withUpdates({ login, displayName, avatarUrl, email });
  }

  // -- Query Methods --

  isDefaultAccount(): boolean {
    return this.props.isDefault;
  }

  belongsTo(userId: string): boolean {
    return this.props.userId === userId;
  }

  // -- Getters --

  get id(): GitHubAccountId {
    return this.props.id;
  }

  get providerAccountId(): string {
    return this.props.id.providerAccountId;
  }

  get userId(): string {
    return this.props.userId;
  }

  get login(): string {
    return this.props.login;
  }

  get displayName(): string | null {
    return this.props.displayName;
  }

  get avatarUrl(): string {
    return this.props.avatarUrl;
  }

  get email(): string | null {
    return this.props.email;
  }

  get isDefault(): boolean {
    return this.props.isDefault;
  }

  get configDir(): string {
    return this.props.configDir;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  // -- Serialization --

  toPlainObject(): {
    providerAccountId: string;
    userId: string;
    login: string;
    displayName: string | null;
    avatarUrl: string;
    email: string | null;
    isDefault: boolean;
    configDir: string;
    createdAt: string;
    updatedAt: string;
  } {
    return {
      providerAccountId: this.props.id.providerAccountId,
      userId: this.props.userId,
      login: this.props.login,
      displayName: this.props.displayName,
      avatarUrl: this.props.avatarUrl,
      email: this.props.email,
      isDefault: this.props.isDefault,
      configDir: this.props.configDir,
      createdAt: this.props.createdAt.toISOString(),
      updatedAt: this.props.updatedAt.toISOString(),
    };
  }

  private withUpdates(updates: Partial<GitHubAccountProps>): GitHubAccount {
    return new GitHubAccount({
      ...this.props,
      ...updates,
      updatedAt: new Date(),
    });
  }
}
