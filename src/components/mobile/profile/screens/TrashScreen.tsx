"use client";

/**
 * TrashScreen — Profile › Trash.
 *
 * Phase 6: stub body. Trash management (restore, permanent delete) lands
 * in a follow-up.
 *
 * TODO: port from the Trash panel that consumes TrashContext.
 */

import { SubScreen } from "../SubScreen";
import { StubBody } from "./StubBody";

export interface TrashScreenProps {
  onBack: () => void;
}

export function TrashScreen({ onBack }: TrashScreenProps) {
  return (
    <SubScreen title="Trash" onBack={onBack}>
      <StubBody
        description="Restore or permanently delete trashed items (30-day retention)."
        portFromComponent="TrashContext consumers"
      />
    </SubScreen>
  );
}
