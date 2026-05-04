"use client";

/**
 * GithubAccountsScreen — Profile › GitHub accounts.
 *
 * Phase 6: stub body. Full multi-account management ports from the desktop
 * component in a follow-up.
 *
 * TODO: port from `src/components/github/GitHubAccountSettings.tsx`
 *       (or whichever desktop component owns the linked-accounts list).
 */

import { SubScreen } from "../SubScreen";
import { StubBody } from "./StubBody";

export interface GithubAccountsScreenProps {
  onBack: () => void;
  /** Convenience: trigger `/api/auth/github/link` for the user. */
  onAddAccount: () => void;
}

export function GithubAccountsScreen({ onBack, onAddAccount }: GithubAccountsScreenProps) {
  return (
    <SubScreen title="GitHub accounts" onBack={onBack}>
      <StubBody
        description="Link, unlink, and bind GitHub accounts to projects."
        portFromComponent="GitHubAccountSettings.tsx"
      />
      <div className="flex justify-center px-4 pb-6">
        <button
          type="button"
          onClick={onAddAccount}
          data-testid="mobile-profile-github-add"
          className="inline-flex h-9 items-center rounded-md border border-border bg-card px-3 text-[13px] font-medium text-foreground active:bg-accent/40"
        >
          Connect a GitHub account
        </button>
      </div>
    </SubScreen>
  );
}
