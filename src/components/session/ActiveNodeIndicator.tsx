"use client";

import { useProjectTree } from "@/contexts/ProjectTreeContext";

/**
 * Small chip showing the currently-active node in the sidebar header.
 * Renders the node name and, for group nodes, a "(rolled up)" suffix so the
 * user knows that the sidebars to the right are aggregating data across
 * descendant projects.
 */
export function ActiveNodeIndicator() {
  const { activeNode, getGroup, getProject } = useProjectTree();
  if (!activeNode) return null;
  const entity =
    activeNode.type === "group"
      ? getGroup(activeNode.id)
      : getProject(activeNode.id);
  if (!entity) return null;
  return (
    <div className="text-xs text-muted-foreground truncate">
      {entity.name}
      {activeNode.type === "group" ? (
        <span className="ml-1 opacity-70">(rolled up)</span>
      ) : null}
    </div>
  );
}
