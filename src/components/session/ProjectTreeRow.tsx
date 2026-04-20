"use client";

import { type ReactNode } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen, Briefcase } from "lucide-react";
import { useProjectTree } from "@/contexts/ProjectTreeContext";

interface Props {
  node: { type: "group"; id: string } | { type: "project"; id: string };
  depth: number;
  onSelect: (node: { id: string; type: "group" | "project" }) => void;
  isActive: boolean;
  children?: ReactNode;
}

export function ProjectTreeRow({ node, depth, onSelect, isActive, children }: Props) {
  const tree = useProjectTree();
  const entity =
    node.type === "group" ? tree.getGroup(node.id) : tree.getProject(node.id);
  if (!entity) return null;

  const isGroup = node.type === "group";
  const isCollapsed = "collapsed" in entity ? entity.collapsed : false;

  const toggleCollapse = async () => {
    if (isGroup) {
      await tree.updateGroup({ id: entity.id, collapsed: !isCollapsed });
    } else {
      await tree.updateProject({ id: entity.id, collapsed: !isCollapsed });
    }
  };

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => onSelect({ id: entity.id, type: node.type })}
        className={`flex items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-muted ${
          isActive ? "bg-muted font-medium" : ""
        }`}
        style={{ paddingLeft: depth * 12 + 8 }}
      >
        {isGroup ? (
          <span
            onClick={(e) => {
              e.stopPropagation();
              void toggleCollapse();
            }}
          >
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </span>
        ) : (
          <span className="w-3.5" />
        )}
        {isGroup ? (
          isCollapsed ? (
            <Folder size={14} />
          ) : (
            <FolderOpen size={14} />
          )
        ) : (
          <Briefcase size={14} />
        )}
        <span className="truncate text-sm">{entity.name}</span>
      </button>
      {isGroup && !isCollapsed ? children : null}
    </div>
  );
}
