/**
 * UnbindProjectFromGitHubAccountUseCase - Remove a project's GitHub account binding.
 */

import type { GitHubAccountRepository } from "@/application/ports/GitHubAccountRepository";

export interface UnbindProjectFromGitHubAccountInput {
  userId: string;
  projectId: string;
}

export class UnbindProjectFromGitHubAccountUseCase {
  constructor(private readonly accountRepo: GitHubAccountRepository) {}

  async execute(input: UnbindProjectFromGitHubAccountInput): Promise<void> {
    await this.accountRepo.unbindProject(input.projectId, input.userId);
  }
}
