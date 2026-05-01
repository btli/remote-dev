"use client";

/**
 * ProjectTreeSheet — Phase 2 mobile redesign.
 *
 * Bottom sheet (75dvh) with a search input on top, a recursive group→project
 * tree in the body, and pinned "+ New project" / "+ New group" buttons in
 * the footer. Tapping a project sets it active and closes the sheet.
 * Tapping a group toggles its expanded state.
 *
 * Designed for mobile density: 44pt touch targets, no hover affordances,
 * a single-column composition. We deliberately do NOT auto-focus the search
 * field on phones — see the Phase 2 brief.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FolderPlus, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  type GroupNode,
  type ProjectNode,
  useProjectTree,
} from "@/contexts/ProjectTreeContext";

import { BottomSheet } from "../common/BottomSheet";

export interface ProjectTreeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the user picks a project (or group). Sheet closes itself. */
  onPickProject?: (projectId: string) => void;
  onPickGroup?: (groupId: string) => void;
  /** Called when user taps "+ New project". Caller wires up the create flow. */
  onCreateProject?: () => void;
  /** Called when user taps "+ New group". */
  onCreateGroup?: () => void;
}

interface FlattenedRow {
  kind: "group" | "project";
  id: string;
  name: string;
  depth: number;
  groupId?: string | null;
  isAutoCreated?: boolean;
}

function buildFlatTree(
  groups: GroupNode[],
  projects: ProjectNode[],
  expanded: Record<string, boolean>,
  searchTerm: string
): FlattenedRow[] {
  const term = searchTerm.trim().toLowerCase();
  const matches = (name: string) => !term || name.toLowerCase().includes(term);

  const childGroups = (parentId: string | null) =>
    groups
      .filter((g) => g.parentGroupId === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  const childProjects = (parentId: string | null) =>
    projects
      .filter((p) => (p.groupId ?? null) === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder);

  const out: FlattenedRow[] = [];

  // When searching, force-expand everything so matches at any depth render.
  const forceExpand = term.length > 0;

  // Track whether each group has any descendant match (so non-matching groups
  // collapse out of the result list).
  const groupHasMatch = (groupId: string): boolean => {
    if (forceExpand) {
      const own = groups.find((g) => g.id === groupId);
      if (own && matches(own.name)) return true;
      const subProjects = childProjects(groupId);
      if (subProjects.some((p) => matches(p.name))) return true;
      const subGroups = childGroups(groupId);
      return subGroups.some((g) => groupHasMatch(g.id));
    }
    return true;
  };

  function walk(parentId: string | null, depth: number) {
    for (const g of childGroups(parentId)) {
      const visible = !forceExpand || groupHasMatch(g.id);
      if (!visible) continue;
      out.push({ kind: "group", id: g.id, name: g.name, depth });
      const isOpen = forceExpand || (expanded[g.id] ?? !g.collapsed);
      if (isOpen) {
        walk(g.id, depth + 1);
        for (const p of childProjects(g.id)) {
          if (!matches(p.name) && !forceExpand) continue;
          if (forceExpand && !matches(p.name)) continue;
          out.push({
            kind: "project",
            id: p.id,
            name: p.name,
            depth: depth + 1,
            groupId: p.groupId,
            isAutoCreated: p.isAutoCreated,
          });
        }
      }
    }
    // Root-level projects (groupId === null) at the very top.
    if (parentId === null) {
      for (const p of childProjects(null)) {
        if (!matches(p.name)) continue;
        out.push({
          kind: "project",
          id: p.id,
          name: p.name,
          depth,
          groupId: null,
          isAutoCreated: p.isAutoCreated,
        });
      }
    }
  }

  walk(null, 0);
  return out;
}

export function ProjectTreeSheet({
  open,
  onOpenChange,
  onPickProject,
  onPickGroup,
  onCreateProject,
  onCreateGroup,
}: ProjectTreeSheetProps) {
  const tree = useProjectTree();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Reset search and expansion overrides when the sheet closes so the next
  // open is a clean slate.
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting transient sheet UI state on close
      setSearch("");
      setExpanded({});
    }
  }, [open]);

  const rows = useMemo(
    () => buildFlatTree(tree.groups, tree.projects, expanded, search),
    [tree.groups, tree.projects, expanded, search]
  );

  const toggleGroup = useCallback(
    (id: string) => {
      setExpanded((prev) => {
        const current = prev[id];
        const fromCtxCollapsed = tree.getGroup(id)?.collapsed ?? false;
        const next = current === undefined ? fromCtxCollapsed : !current;
        return { ...prev, [id]: next };
      });
    },
    [tree]
  );

  const handlePickProject = useCallback(
    (projectId: string) => {
      void tree.setActiveNode({ id: projectId, type: "project" });
      onPickProject?.(projectId);
      onOpenChange(false);
    },
    [tree, onPickProject, onOpenChange]
  );

  const handlePickGroup = useCallback(
    (groupId: string) => {
      // We let users select a group as the active node too; project-scoped
      // views aggregate descendant projects when the active node is a group.
      void tree.setActiveNode({ id: groupId, type: "group" });
      onPickGroup?.(groupId);
      onOpenChange(false);
    },
    [tree, onPickGroup, onOpenChange]
  );

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Projects"
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              onOpenChange(false);
              onCreateProject?.();
            }}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-card",
              "px-3 min-h-[44px] text-sm font-medium text-foreground",
              "hover:bg-accent/40 active:bg-accent/60"
            )}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            New project
          </button>
          <button
            type="button"
            onClick={() => {
              onOpenChange(false);
              onCreateGroup?.();
            }}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-card",
              "px-3 min-h-[44px] text-sm font-medium text-foreground",
              "hover:bg-accent/40 active:bg-accent/60"
            )}
          >
            <FolderPlus aria-hidden="true" className="h-4 w-4" />
            New group
          </button>
        </div>
      }
    >
      <div className="px-3 pt-1 pb-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          // Phone behavior: do NOT auto-focus. Tapping the input opens the
          // keyboard; the rail itself is the primary affordance.
          autoFocus={false}
          placeholder="Search projects"
          aria-label="Search projects"
          className={cn(
            "w-full rounded-md border border-border bg-background",
            "px-3 min-h-[44px] text-sm text-foreground placeholder:text-muted-foreground/70",
            "focus:outline-none focus:ring-2 focus:ring-ring/50"
          )}
        />
      </div>
      <ul role="tree" className="px-1 pb-2" data-testid="mobile-project-tree-rows">
        {rows.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-muted-foreground">
            {search ? "No matches." : "No projects yet."}
          </li>
        ) : null}
        {rows.map((row) => {
          if (row.kind === "group") {
            const isOpen =
              expanded[row.id] !== undefined
                ? expanded[row.id]
                : !(tree.getGroup(row.id)?.collapsed ?? false);
            const groupSelected =
              tree.activeNode?.type === "group" && tree.activeNode.id === row.id;
            return (
              <li
                key={`group-${row.id}`}
                role="treeitem"
                aria-expanded={isOpen}
                aria-selected={groupSelected}
              >
                <div
                  className={cn(
                    "flex items-stretch rounded-md",
                    "active:bg-accent/40"
                  )}
                  style={{ paddingLeft: `${row.depth * 12}px` }}
                >
                  <button
                    type="button"
                    aria-label={`${isOpen ? "Collapse" : "Expand"} ${row.name}`}
                    onClick={() => toggleGroup(row.id)}
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-md",
                      "text-muted-foreground hover:bg-accent/40"
                    )}
                  >
                    {isOpen ? (
                      <ChevronDown aria-hidden="true" className="h-4 w-4" />
                    ) : (
                      <ChevronRight aria-hidden="true" className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePickGroup(row.id)}
                    className={cn(
                      "flex flex-1 min-h-[44px] items-center px-2 text-left",
                      "text-sm font-medium text-foreground",
                      "hover:bg-accent/40"
                    )}
                  >
                    <span className="truncate">{row.name}</span>
                  </button>
                </div>
              </li>
            );
          }
          const projectSelected =
            tree.activeNode?.type === "project" && tree.activeNode.id === row.id;
          return (
            <li
              key={`project-${row.id}`}
              role="treeitem"
              aria-selected={projectSelected}
            >
              <button
                type="button"
                onClick={() => handlePickProject(row.id)}
                data-project-id={row.id}
                className={cn(
                  "flex w-full min-h-[44px] items-center rounded-md px-2 text-left",
                  "text-sm font-normal text-foreground",
                  "hover:bg-accent/40 active:bg-accent/60",
                  tree.activeNode?.type === "project" && tree.activeNode.id === row.id && "bg-accent/30 font-medium"
                )}
                style={{ paddingLeft: `${row.depth * 12 + 12}px` }}
              >
                <span className="truncate">{row.name}</span>
                {row.isAutoCreated ? (
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                    auto
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );
}
