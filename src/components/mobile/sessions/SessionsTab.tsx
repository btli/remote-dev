"use client";

/**
 * SessionsTab — Phase 2 mobile redesign home screen.
 *
 * The Sessions tab is the mobile home. Composition (top to bottom):
 *
 *   1. Header strip: project switcher chip on the left, "+ New" pill on the
 *      right, plus a horizontal rail of last-3-projects quick-switches.
 *   2. Empty / loading / error states for the session list, OR
 *   3. The session list (active session pinned to the top, rest sorted by
 *      `lastActivityAt` desc).
 *
 * The tab is rendered inside {@link MobileShell}, which provides the bottom
 * tab bar and the top safe-area inset. This component owns its scroll
 * container; the shell's outer scroller is what powers auto-hide-on-scroll
 * on the bottom bar.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  type ActiveNode,
  useProjectTree,
} from "@/contexts/ProjectTreeContext";
import { useSessionContext } from "@/contexts/SessionContext";
import type { TerminalSession } from "@/types/session";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";

import { ActionSheet, type ActionSheetItem } from "../common/ActionSheet";

import { MobileSessionRow } from "./MobileSessionRow";
import { NewSessionSheet } from "./NewSessionSheet";
import { ProjectTreeSheet } from "./ProjectTreeSheet";

const RECENT_PROJECTS_STORAGE_KEY = "remote-dev:mobile:recent-projects";
const RECENT_LIMIT = 3;

export interface SessionsTabProps {
  isGitHubConnected: boolean;
  /** Reports the row this tab considers its scroll container, so MobileShell
   * can flow auto-hide of the bottom bar from inner scroll if it wants.
   * Currently unused; the shell wraps us in its own scroller. */
  scrollContainerRef?: (el: HTMLDivElement | null) => void;
}

function loadRecentProjectIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_PROJECTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string").slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

function saveRecentProjectIds(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      RECENT_PROJECTS_STORAGE_KEY,
      JSON.stringify(ids.slice(0, RECENT_LIMIT))
    );
  } catch {
    // Ignore storage errors (quota, private mode, etc.).
  }
}

export function SessionsTab({ isGitHubConnected }: SessionsTabProps) {
  const projectTree = useProjectTree();
  const sessionCtx = useSessionContext();

  const [treeSheetOpen, setTreeSheetOpen] = useState(false);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [actionSheetSessionId, setActionSheetSessionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [recentProjectIds, setRecentProjectIds] = useState<string[]>([]);
  // Hydrate from localStorage on mount. This is a one-time external-store
  // sync, not a state-derived render — the project keeps the codebase's
  // existing pattern (see ProjectTreeContext refresh()).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from localStorage
    setRecentProjectIds(loadRecentProjectIds());
  }, []);

  // Persist whenever the active node changes to a project.
  useEffect(() => {
    const active = projectTree.activeNode;
    if (!active || active.type !== "project") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing recent-projects list to active-node updates
    setRecentProjectIds((prev) => {
      const filtered = prev.filter((id) => id !== active.id);
      const next = [active.id, ...filtered].slice(0, RECENT_LIMIT);
      saveRecentProjectIds(next);
      return next;
    });
  }, [projectTree.activeNode]);

  const activeNode: ActiveNode | null = projectTree.activeNode;

  // Resolve the chip label.
  const chipLabel = useMemo(() => {
    if (!activeNode) return "All projects";
    if (activeNode.type === "group") {
      return projectTree.getGroup(activeNode.id)?.name ?? "All projects";
    }
    return projectTree.getProject(activeNode.id)?.name ?? "All projects";
  }, [activeNode, projectTree]);

  // Sessions to render. Filter to active+suspended (sessions context already
  // does this on fetch, but be defensive). Pin the active session, then sort
  // the rest by lastActivityAt desc.
  const visibleSessions = useMemo(() => {
    const open = sessionCtx.sessions.filter(
      (s) => s.status === "active" || s.status === "suspended"
    );

    // Scope to the active node:
    //   - project node → only that project
    //   - group node → for now, all sessions (group descendant aggregation
    //     lives in ProjectTreeContext-side helpers we don't pull here yet)
    //   - null → all sessions
    let scoped: TerminalSession[] = open;
    if (activeNode?.type === "project") {
      scoped = open.filter((s) => s.projectId === activeNode.id);
    }

    const activeId = sessionCtx.activeSessionId;
    const pinned = activeId ? scoped.filter((s) => s.id === activeId) : [];
    const rest = scoped
      .filter((s) => s.id !== activeId)
      .sort((a, b) => {
        const at = a.lastActivityAt instanceof Date ? a.lastActivityAt.getTime() : new Date(a.lastActivityAt).getTime();
        const bt = b.lastActivityAt instanceof Date ? b.lastActivityAt.getTime() : new Date(b.lastActivityAt).getTime();
        return bt - at;
      });
    return [...pinned, ...rest];
  }, [sessionCtx.sessions, sessionCtx.activeSessionId, activeNode]);

  // Pull-to-refresh
  const handleRefresh = useCallback(async () => {
    setErrorMessage(null);
    try {
      await sessionCtx.refreshSessions();
    } catch (err) {
      setErrorMessage(`Couldn't load sessions. Pull to retry. (${String(err)})`);
    }
  }, [sessionCtx]);

  const pull = usePullToRefresh({ onRefresh: handleRefresh });

  // Action sheet items for the long-pressed session.
  const actionSession = useMemo(
    () => visibleSessions.find((s) => s.id === actionSheetSessionId) ?? null,
    [visibleSessions, actionSheetSessionId]
  );

  // Suspend with undo toast.
  const performSuspend = useCallback(
    (sessionId: string) => {
      const session = sessionCtx.sessions.find((s) => s.id === sessionId);
      if (!session || session.status !== "active") return;
      // Optimistic in-context update happens inside suspendSession().
      void sessionCtx.suspendSession(sessionId).catch(() => {
        toast.error("Couldn't suspend session.");
      });
      toast(`Suspended "${session.name}"`, {
        duration: 5000,
        action: {
          label: "Undo",
          onClick: () => {
            void sessionCtx.resumeSession(sessionId).catch(() => {
              toast.error("Couldn't resume session.");
            });
          },
        },
      });
    },
    [sessionCtx]
  );

  const performResume = useCallback(
    (sessionId: string) => {
      void sessionCtx.resumeSession(sessionId).catch(() => {
        toast.error("Couldn't resume session.");
      });
    },
    [sessionCtx]
  );

  const performClose = useCallback(
    (sessionId: string) => {
      const session = sessionCtx.sessions.find((s) => s.id === sessionId);
      void sessionCtx.closeSession(sessionId).catch(() => {
        toast.error("Couldn't close session.");
      });
      if (session) {
        toast(`Closed "${session.name}"`);
      }
    },
    [sessionCtx]
  );

  const actionItems = useMemo<ActionSheetItem[]>(() => {
    if (!actionSession) return [];
    const items: ActionSheetItem[] = [];
    if (actionSession.status === "active") {
      items.push({
        id: "suspend",
        label: "Suspend",
        onSelect: () => performSuspend(actionSession.id),
      });
    } else if (actionSession.status === "suspended") {
      items.push({
        id: "resume",
        label: "Resume",
        onSelect: () => performResume(actionSession.id),
      });
    }
    items.push({
      id: "rename",
      label: "Rename",
      disabled: true, // Inline rename UI lives in Phase 3+; expose the slot now.
      onSelect: () => {
        toast("Rename coming soon.");
      },
    });
    items.push({
      id: "move",
      label: "Move to project…",
      disabled: true,
      onSelect: () => {
        toast("Move coming soon.");
      },
    });
    items.push({
      id: "recordings",
      label: "View recordings",
      disabled: true,
      onSelect: () => {
        toast("Recordings coming soon.");
      },
    });
    items.push({
      id: "close",
      label: "Close session",
      destructive: true,
      onSelect: () => performClose(actionSession.id),
    });
    return items;
  }, [actionSession, performSuspend, performResume, performClose]);

  // Tap on a row → set as active session.
  const handleTapSession = useCallback(
    (sessionId: string) => {
      sessionCtx.setActiveSession(sessionId);
    },
    [sessionCtx]
  );

  // Last-3-projects rail.
  const recentProjects = useMemo(() => {
    const ids = recentProjectIds;
    return ids
      .map((id) => projectTree.getProject(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
  }, [recentProjectIds, projectTree]);

  // Whether to render the rail.
  const railVisible = projectTree.projects.length >= 2 && recentProjects.length > 0;

  // The rendered list region, with empty / loading / error states.
  const isLoading = sessionCtx.loading || projectTree.isLoading;

  // Selecting a project from the rail.
  const handlePickRecentProject = useCallback(
    (projectId: string) => {
      void projectTree.setActiveNode({ id: projectId, type: "project" });
    },
    [projectTree]
  );

  // First-render: hook up an outer scroll element ref-callback for pull-to-refresh.
  const outerRef = useRef<HTMLDivElement>(null);
  const setRefBoth = useCallback(
    (el: HTMLDivElement | null) => {
      outerRef.current = el;
      pull.ref(el);
    },
    [pull]
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header strip */}
      <header
        data-testid="mobile-sessions-header"
        className={cn(
          "sticky top-0 z-20 flex flex-col gap-2 border-b border-border bg-card",
          "px-3 pt-2 pb-2"
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setTreeSheetOpen(true)}
            data-testid="mobile-project-chip"
            className={cn(
              "inline-flex max-w-[70%] items-center gap-1 rounded-md",
              "px-3 min-h-[44px] text-sm font-medium text-foreground",
              "hover:bg-accent/40 active:bg-accent/60",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            )}
            aria-label={`Switch project, current: ${chipLabel}`}
          >
            <span className="truncate">{chipLabel}</span>
            <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
          <button
            type="button"
            onClick={() => setNewSessionOpen(true)}
            data-testid="mobile-new-session-button"
            className={cn(
              "inline-flex items-center gap-1 rounded-full border border-border bg-card",
              "px-3 min-h-[44px] text-sm font-medium text-foreground",
              "hover:bg-accent/40 active:bg-accent/60",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            )}
            aria-label="New session"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            New
          </button>
        </div>

        {railVisible ? (
          <ul
            data-testid="mobile-recent-projects-rail"
            className="-mx-1 flex gap-1 overflow-x-auto pb-1"
            role="list"
          >
            {recentProjects.map((p) => {
              const active =
                activeNode?.type === "project" && activeNode.id === p.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => handlePickRecentProject(p.id)}
                    data-project-id={p.id}
                    className={cn(
                      "inline-flex shrink-0 items-center rounded-md border border-border",
                      "px-3 min-h-[36px] text-xs",
                      // Achromatic active treatment: weight + tint, not color.
                      active
                        ? "bg-accent/30 font-medium text-foreground"
                        : "bg-card font-normal text-muted-foreground",
                      "hover:bg-accent/40 active:bg-accent/60"
                    )}
                  >
                    <span className="max-w-[12ch] truncate">{p.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </header>

      {/* Content area: error banner + list (or empty state). */}
      <div
        ref={setRefBoth}
        data-testid="mobile-sessions-scroll"
        className="flex-1 overflow-y-auto overscroll-contain"
        style={{
          // Visual pull indicator: translate the content down a few px while
          // dragging. The hook returns 0 in reduced-motion, so this stays
          // stationary then.
          transform: pull.pullDistance > 0 ? `translateY(${pull.pullDistance}px)` : undefined,
          transitionProperty: pull.pullDistance === 0 ? "transform" : "none",
          transitionDuration: pull.pullDistance === 0 ? "180ms" : "0ms",
        }}
      >
        {/* Subtle pull/refresh indicator: a single line of muted text, no
            big spinner overlay. */}
        {(pull.pullDistance > 0 || pull.isRefreshing) ? (
          <div
            className="flex items-center justify-center py-2 text-xs text-muted-foreground"
            data-testid="mobile-sessions-refresh-indicator"
            role="status"
            aria-live="polite"
          >
            {pull.isRefreshing ? "Refreshing…" : "Pull to refresh"}
          </div>
        ) : null}

        {errorMessage ? (
          <div
            data-testid="mobile-sessions-error"
            role="alert"
            className="m-3 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {errorMessage}
          </div>
        ) : null}

        {isLoading && visibleSessions.length === 0 ? (
          <SessionListSkeleton />
        ) : visibleSessions.length === 0 ? (
          <SessionsEmptyState
            hasProject={
              !!activeNode &&
              (activeNode.type === "project" ||
                projectTree.projects.length > 0)
            }
            projectName={
              activeNode?.type === "project"
                ? projectTree.getProject(activeNode.id)?.name ?? null
                : null
            }
            onChooseProject={() => setTreeSheetOpen(true)}
            onStartSession={() => setNewSessionOpen(true)}
          />
        ) : (
          <ul role="list" data-testid="mobile-sessions-list">
            {visibleSessions.map((s) => (
              <li key={s.id}>
                <MobileSessionRow
                  session={s}
                  activity={sessionCtx.getAgentActivityStatus(s.id)}
                  active={s.id === sessionCtx.activeSessionId}
                  onTap={handleTapSession}
                  onLongPress={(id) => setActionSheetSessionId(id)}
                  onSwipeSuspend={performSuspend}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Sheets */}
      <ProjectTreeSheet
        open={treeSheetOpen}
        onOpenChange={setTreeSheetOpen}
      />
      <NewSessionSheet
        open={newSessionOpen}
        onOpenChange={setNewSessionOpen}
        isGitHubConnected={isGitHubConnected}
      />
      <ActionSheet
        open={actionSheetSessionId !== null}
        onOpenChange={(open) => {
          if (!open) setActionSheetSessionId(null);
        }}
        title={actionSession?.name}
        items={actionItems}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sub-components                                                              */
/* -------------------------------------------------------------------------- */

function SessionListSkeleton() {
  // Match the row shape so the layout doesn't shift when real rows replace
  // the skeleton. Six rows is enough to cover the average phone fold.
  const rows = [0, 1, 2, 3, 4, 5];
  return (
    <ul
      role="list"
      aria-busy="true"
      data-testid="mobile-sessions-skeleton"
      className="animate-pulse"
    >
      {rows.map((i) => (
        <li
          key={i}
          className="flex items-center gap-3 border-b border-border/60 px-4 py-3 min-h-[56px]"
        >
          <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/30" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-2/3 rounded bg-muted-foreground/15" />
            <div className="h-2.5 w-1/3 rounded bg-muted-foreground/10" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function SessionsEmptyState({
  hasProject,
  projectName,
  onChooseProject,
  onStartSession,
}: {
  hasProject: boolean;
  projectName: string | null;
  onChooseProject: () => void;
  onStartSession: () => void;
}) {
  if (!hasProject) {
    return (
      <div
        data-testid="mobile-sessions-empty-noproject"
        className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center"
      >
        <p className="text-base font-medium text-foreground">No project yet.</p>
        <p className="text-sm text-muted-foreground">
          Create or pick a project to start a session.
        </p>
        <button
          type="button"
          onClick={onChooseProject}
          className={cn(
            "inline-flex items-center justify-center rounded-md",
            "bg-primary px-3 min-h-[44px] text-sm font-medium text-primary-foreground",
            "hover:bg-primary/90 active:bg-primary/80"
          )}
        >
          Choose a project
        </button>
      </div>
    );
  }
  return (
    <div
      data-testid="mobile-sessions-empty-nosessions"
      className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center"
    >
      <p className="text-base font-medium text-foreground">
        No sessions {projectName ? `in ${projectName}` : "yet"}.
      </p>
      <p className="text-sm text-muted-foreground">
        Start a new session to attach a terminal or agent.
      </p>
      <button
        type="button"
        onClick={onStartSession}
        className={cn(
          "inline-flex items-center justify-center rounded-md",
          "bg-primary px-3 min-h-[44px] text-sm font-medium text-primary-foreground",
          "hover:bg-primary/90 active:bg-primary/80"
        )}
      >
        Start a session
      </button>
    </div>
  );
}
