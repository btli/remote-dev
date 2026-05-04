"use client";

/**
 * SettingsScreen — Profile › Settings.
 *
 * Phase 6: stub body. Full user-level settings (theme, default agent,
 * etc.) land in a follow-up.
 *
 * TODO: port from `src/components/system/UserSettingsModal.tsx`
 *       (non-Account tabs).
 */

import { SubScreen } from "../SubScreen";
import { StubBody } from "./StubBody";

export interface SettingsScreenProps {
  onBack: () => void;
}

export function SettingsScreen({ onBack }: SettingsScreenProps) {
  return (
    <SubScreen title="Settings" onBack={onBack}>
      <StubBody
        description="User-level preferences: theme, default agent, telemetry."
        portFromComponent="UserSettingsModal.tsx (non-Account tabs)"
      />
    </SubScreen>
  );
}
