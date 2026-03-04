/**
 * GitHubAccountId - Value object wrapping the composite key for a GitHub account.
 *
 * The `accounts` table uses (provider, providerAccountId) as the composite PK.
 * This value object ensures the pair is always passed together and validated.
 */

import { InvalidValueError } from "../errors/DomainError";

export class GitHubAccountId {
  readonly provider = "github" as const;

  private constructor(readonly providerAccountId: string) {}

  static create(providerAccountId: string): GitHubAccountId {
    if (!providerAccountId) {
      throw new InvalidValueError(
        "GitHubAccountId.providerAccountId",
        providerAccountId,
        "Must be a non-empty string"
      );
    }
    return new GitHubAccountId(providerAccountId);
  }

  static fromString(value: string): GitHubAccountId {
    if (!value || !value.startsWith("github:")) {
      throw new InvalidValueError(
        "GitHubAccountId",
        value,
        'Must be in format "github:{providerAccountId}"'
      );
    }
    return GitHubAccountId.create(value.slice("github:".length));
  }

  toString(): string {
    return `github:${this.providerAccountId}`;
  }

  equals(other: GitHubAccountId): boolean {
    return this.providerAccountId === other.providerAccountId;
  }
}
