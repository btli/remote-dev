"use client";

import { useMemo } from "react";
import { useProjectTree } from "@/contexts/ProjectTreeContext";
import { ProjectTreeRow } from "./ProjectTreeRow";

interface Props {
  /**
   * Called when the user clicks the settings gear on a row. Receives the
   * node's id, type, and display name so the caller can open the
   * corresponding Group/ProjectPreferencesModal.
   */
  onOpenPreferences?: (node: {
    id: string;
    type: "group" | "project";
    name: string;
  }) => void;
}

export function ProjectTreeSidebar({ onOpenPreferences }: Props = {}) {
  const tree = useProjectTree();
  const rootEntries = useMemo(() => tree.getChildrenOfGroup(null), [tree]);

  function renderGroupSubtree(groupId: string, depth: number) {
    const { groups: childGroups, projects: childProjects } = tree.getChildrenOfGroup(groupId);
    return (
      <>
        {childGroups.map((g) => (
          <ProjectTreeRow
            key={g.id}
            node={{ type: "group", id: g.id }}
            depth={depth}
            isActive={tree.activeNode?.id === g.id && tree.activeNode?.type === "group"}
            onSelect={(n) => void tree.setActiveNode(n)}
            onOpenPreferences={onOpenPreferences}
          >
            {renderGroupSubtree(g.id, depth + 1)}
          </ProjectTreeRow>
        ))}
        {childProjects.map((p) => (
          <ProjectTreeRow
            key={p.id}
            node={{ type: "project", id: p.id }}
            depth={depth}
            isActive={tree.activeNode?.id === p.id && tree.activeNode?.type === "project"}
            onSelect={(n) => void tree.setActiveNode(n)}
            onOpenPreferences={onOpenPreferences}
          />
        ))}
      </>
    );
  }

  if (tree.isLoading) {
    return <div className="p-3 text-xs text-muted-foreground">Loading projects…</div>;
  }

  return (
    <div className="flex flex-col gap-0.5 px-1 py-2">
      {rootEntries.groups.map((g) => (
        <ProjectTreeRow
          key={g.id}
          node={{ type: "group", id: g.id }}
          depth={0}
          isActive={tree.activeNode?.id === g.id && tree.activeNode?.type === "group"}
          onSelect={(n) => void tree.setActiveNode(n)}
          onOpenPreferences={onOpenPreferences}
        >
          {renderGroupSubtree(g.id, 1)}
        </ProjectTreeRow>
      ))}
    </div>
  );
}
