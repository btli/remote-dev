"use client";

/**
 * AgentProfilesScreen — Profile › Agent profiles.
 *
 * Phase 6: stub body. Full profile CRUD + per-profile theming lands
 * in a follow-up.
 *
 * TODO: port from `src/components/agents/` (profile list + appearance).
 */

import { SubScreen } from "../SubScreen";
import { StubBody } from "./StubBody";

export interface AgentProfilesScreenProps {
  onBack: () => void;
}

export function AgentProfilesScreen({ onBack }: AgentProfilesScreenProps) {
  return (
    <SubScreen title="Agent profiles" onBack={onBack}>
      <StubBody
        description="Manage isolated agent profiles and their appearance."
        portFromComponent="components/agents/* (profile list + appearance)"
      />
    </SubScreen>
  );
}
