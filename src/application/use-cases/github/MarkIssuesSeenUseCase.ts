/**
 * MarkIssuesSeenUseCase - Clears "new" flags on issues when user views them.
 *
 * This use case handles:
 * 1. Marking all issues in a repository as seen
 * 2. Marking a specific issue as seen
 * 3. Returning updated counts
 */

import type { GitHubIssueRepository } from "@/application/ports/GitHubIssueRepository";

export interface MarkIssuesSeenInput {
  /** Repository ID */
  repositoryId: string;
  /** Optional: mark only a specific issue by number */
  issueNumber?: number;
}

export interface MarkIssuesSeenOutput {
  /** Number of issues marked as seen */
  markedCount: number;
  /** Whether any issues were marked */
  success: boolean;
}

export class MarkIssuesSeenUseCase {
  constructor(private readonly issueRepository: GitHubIssueRepository) {}

  async execute(input: MarkIssuesSeenInput): Promise<MarkIssuesSeenOutput> {
    const { repositoryId, issueNumber } = input;

    if (issueNumber !== undefined) {
      // Mark specific issue as seen
      const success = await this.issueRepository.markAsSeen(
        repositoryId,
        issueNumber
      );
      return {
        markedCount: success ? 1 : 0,
        success,
      };
    }

    // Mark all issues in repository as seen
    const markedCount = await this.issueRepository.markAllAsSeen(repositoryId);
    return {
      markedCount,
      success: markedCount >= 0,
    };
  }
}
