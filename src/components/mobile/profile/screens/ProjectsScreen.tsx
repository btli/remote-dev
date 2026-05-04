"use client";

/**
 * ProjectsScreen — Profile › Projects (group + project tree management).
 *
 * Phase 6: stub body. Full tree management (create / rename / move /
 * delete groups and projects) lands in a follow-up.
 *
 * TODO: port from `src/components/session/ProjectTreeSidebar.tsx`
 *       and `GroupPreferencesModal.tsx` / `ProjectPreferencesModal.tsx`.
 */

import { SubScreen } from "../SubScreen";
import { StubBody } from "./StubBody";

export interface ProjectsScreenProps {
  onBack: () => void;
}

export function ProjectsScreen({ onBack }: ProjectsScreenProps) {
  return (
    <SubScreen title="Projects" onBack={onBack}>
      <StubBody
        description="Manage project groups, projects, and their preferences."
        portFromComponent="ProjectTreeSidebar.tsx"
      />
    </SubScreen>
  );
}
