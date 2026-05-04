"use client";

/**
 * PortsScreen — Profile › Ports.
 *
 * Phase 6: stub body. Port allocation registry / framework detection
 * UI lands in a follow-up.
 *
 * TODO: port from the Ports panel surfaced in PortContext consumers.
 */

import { SubScreen } from "../SubScreen";
import { StubBody } from "./StubBody";

export interface PortsScreenProps {
  onBack: () => void;
}

export function PortsScreen({ onBack }: PortsScreenProps) {
  return (
    <SubScreen title="Ports" onBack={onBack}>
      <StubBody
        description="Inspect port allocations and framework auto-detection."
        portFromComponent="PortContext consumers"
      />
    </SubScreen>
  );
}
