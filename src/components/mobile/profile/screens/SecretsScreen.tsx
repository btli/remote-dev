"use client";

/**
 * SecretsScreen — Profile › Secrets.
 *
 * Phase 6: stub body. Per-project secrets provider configuration lands
 * in a follow-up.
 *
 * TODO: port from `src/components/system/SecretsConfigModal.tsx` and
 *       `SecretsStatusButton.tsx`.
 */

import { SubScreen } from "../SubScreen";
import { StubBody } from "./StubBody";

export interface SecretsScreenProps {
  onBack: () => void;
}

export function SecretsScreen({ onBack }: SecretsScreenProps) {
  return (
    <SubScreen title="Secrets" onBack={onBack}>
      <StubBody
        description="Configure secrets providers for each project."
        portFromComponent="SecretsConfigModal.tsx"
      />
    </SubScreen>
  );
}
