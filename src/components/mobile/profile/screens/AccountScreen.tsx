"use client";

/**
 * AccountScreen — Profile › Account.
 *
 * Phase 6: header + signed-in-as line + stub body. The full account
 * management UI (display name, theme override, sign-out also lives in
 * the parent index per the brief) lands in a follow-up.
 *
 * TODO: port the relevant pieces of `src/components/system/UserSettingsModal.tsx`
 * Account-tab sections into this screen.
 */

import { SubScreen } from "../SubScreen";
import { StubBody } from "./StubBody";

export interface AccountScreenProps {
  email: string | null | undefined;
  displayName: string | null | undefined;
  onBack: () => void;
}

export function AccountScreen({ email, displayName, onBack }: AccountScreenProps) {
  return (
    <SubScreen title="Account" onBack={onBack}>
      <div className="flex flex-col gap-4 px-4 pt-4">
        <dl className="flex flex-col gap-3 text-[14px]">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="truncate text-right font-medium text-foreground">
              {email ?? "—"}
            </dd>
          </div>
          {displayName ? (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground">Name</dt>
              <dd className="truncate text-right text-foreground">{displayName}</dd>
            </div>
          ) : null}
        </dl>
      </div>
      <StubBody
        description="View and update your account profile."
        portFromComponent="UserSettingsModal.tsx (Account tab)"
      />
    </SubScreen>
  );
}
