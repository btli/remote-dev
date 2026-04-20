"use client";

import { type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Briefcase,
  Settings,
} from "lucide-react";
import { useProjectTree } from "@/contexts/ProjectTreeContext";

interface Props {
  node: { type: "group"; id: string } | { type: "project"; id: string };
  depth: number;
  onSelect: (node: { id: string; type: "group" | "project" }) => void;
  isActive: boolean;
  onOpenPreferences?: (node: {
    id: string;
    type: "group" | "project";
    name: string;
  }) => void;
  children?: ReactNode;
}

export function ProjectTreeRow({
  node,
  depth,
  onSelect,
  isActive,
  onOpenPreferences,
  children,
}: Props) {
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
      <div
        className={`group flex items-center gap-1.5 rounded hover:bg-muted ${
          isActive ? "bg-muted font-medium" : ""
        }`}
      >
        <button
          type="button"
          onClick={() => onSelect({ id: entity.id, type: node.type })}
          className="flex flex-1 min-w-0 items-center gap-1.5 px-2 py-1 text-left"
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
        {onOpenPreferences ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenPreferences({
                id: entity.id,
                type: node.type,
                name: entity.name,
              });
            }}
            className="mr-1 opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-foreground transition"
            title={`${isGroup ? "Group" : "Project"} settings`}
          >
            <Settings size={12} />
          </button>
        ) : null}
      </div>
      {isGroup && !isCollapsed ? children : null}
    </div>
  );
}
