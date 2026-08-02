/**
 * SelectProfileUseCase - Resolve which Claude ACCOUNT (and, when it has one,
 * which origin profile) to launch for a project.
 *
 * Explicit selection always wins (the user picked a profile/account in the
 * wizard). Otherwise delegate to the ProfileSelectionPolicy (primary → fallback
 * pool with rotation). The "launch now" path never throws on "all limited": the
 * policy returns a best-effort account and we surface it, and "nothing
 * configured" surfaces as a null selection (caller proceeds with no
 * profile/account = today's behavior).
 *
 * [remote-dev-n4x4.6] The result carries BOTH ids: `accountId` decides which
 * `CLAUDE_CODE_OAUTH_TOKEN` the session gets, `profileId` decides which config
 * dir / env overlay it runs under. They are independent — an account may have
 * no origin profile, and an explicitly-pinned profile may have no account.
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
  /**
   * The model this session will run (e.g. `claude-fable-5`, or a CLI alias
   * like `opus`). [remote-dev-n4x4.3] Lets the policy skip an account whose
   * per-model weekly window is exhausted even though the account itself still
   * reads available. Omitted / unknown must NEVER narrow availability.
   */
  requestedModel?: string | null;
}

export interface SelectProfileResult {
  /** The chosen profile, or null when nothing is configured/selected. */
  profileId: string | null;
  /** The chosen Claude account, or null when none is configured/selected. */
  accountId: string | null;
  /** True when the policy chose the account (no explicit selection). */
  wasAutoSelected: boolean;
}

export class SelectProfileUseCase {
  constructor(
    private readonly selectionPolicy: ProfileSelectionPolicy
  ) {}

  async execute(input: SelectProfileInput): Promise<SelectProfileResult> {
    // Explicit selection wins outright — no policy involvement. The account is
    // left unresolved here; the caller resolves the pinned profile's account
    // (if any) when it builds the session env.
    if (input.explicitProfileId) {
      return {
        profileId: input.explicitProfileId,
        accountId: null,
        wasAutoSelected: false,
      };
    }

    const now = input.now ?? new Date();
    const selected = await this.selectionPolicy.selectForProject(
      input.projectId,
      input.userId,
      now,
      input.requestedModel ?? null
    );

    if (!selected) {
      return { profileId: null, accountId: null, wasAutoSelected: false };
    }

    return {
      profileId: selected.profileId,
      accountId: selected.accountId,
      wasAutoSelected: true,
    };
  }
}
