/**
 * SelectProfileUseCase - Resolve which Claude profile to launch for a project.
 *
 * Explicit selection always wins (the user picked a profile in the wizard).
 * Otherwise delegate to the ProfileSelectionPolicy (primary → fallback pool
 * with rotation). The "launch now" path never throws on "all limited": the
 * policy returns a best-effort profile and we surface it, and "nothing
 * configured" surfaces as a null profile (caller proceeds with no profile =
 * today's behavior).
 *
 * Depends only on the policy port — unit-tested with an in-memory fake.
 */

import type { ProfileSelectionPolicy } from "@/application/ports/ProfileSelectionPolicy";

export interface SelectProfileInput {
  projectId: string;
  userId: string;
  /** A profile the user explicitly chose; when set it always wins. */
  explicitProfileId?: string | null;
  /** Selection time; defaults to now (drives availability checks). */
  now?: Date;
}

export interface SelectProfileResult {
  /** The chosen profile, or null when nothing is configured/selected. */
  profileId: string | null;
  /** True when the policy chose the profile (no explicit selection). */
  wasAutoSelected: boolean;
}

export class SelectProfileUseCase {
  constructor(
    private readonly selectionPolicy: ProfileSelectionPolicy
  ) {}

  async execute(input: SelectProfileInput): Promise<SelectProfileResult> {
    // Explicit selection wins outright — no policy involvement.
    if (input.explicitProfileId) {
      return { profileId: input.explicitProfileId, wasAutoSelected: false };
    }

    const now = input.now ?? new Date();
    const profileId = await this.selectionPolicy.selectForProject(
      input.projectId,
      input.userId,
      now
    );

    return { profileId, wasAutoSelected: profileId !== null };
  }
}
