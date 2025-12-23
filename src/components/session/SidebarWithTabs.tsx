"use client";

/**
 * SidebarWithTabs - Wrapper that adds tab navigation between Sessions and Repositories
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Terminal, Github } from "lucide-react";
import { Sidebar, type SessionFolder } from "./Sidebar";
import { RepositoriesTab } from "@/components/github/RepositoriesTab";
import { ChangeIndicator } from "@/components/github/StatusBadge";
import { useGitHubChanges } from "@/contexts/GitHubStatsContext";
import type { TerminalSession } from "@/types/session";

type SidebarTab = "sessions" | "repositories";

interface SidebarWithTabsProps {
  // Session props (passed to Sidebar)
  sessions: TerminalSession[];
  folders: SessionFolder[];
  sessionFolders: Record<string, string>;
  activeSessionId: string | null;
  activeFolderId: string | null;
  folderHasPreferences: (folderId: string) => boolean;
  onSessionClick: (sessionId: string) => void;
  onSessionClose: (sessionId: string) => void;
  onSessionRename: (sessionId: string, newName: string) => void;
  onSessionMove: (sessionId: string, folderId: string | null) => void;
  onNewSession: () => void;
  onQuickNewSession: () => void;
  onFolderCreate: (name: string) => void;
  onFolderRename: (folderId: string, newName: string) => void;
  onFolderDelete: (folderId: string) => void;
  onFolderToggle: (folderId: string) => void;
  onFolderClick: (folderId: string) => void;
  onFolderSettings: (folderId: string, folderName: string) => void;
  onFolderNewSession: (folderId: string) => void;

  // GitHub props
  isGitHubConnected?: boolean;
  onCreatePRWorktree?: (repoId: string, prNumber: number) => Promise<void>;
  onGitHubSettings?: () => void;
}

export function SidebarWithTabs({
  isGitHubConnected = false,
  onCreatePRWorktree,
  onGitHubSettings,
  ...sessionProps
}: SidebarWithTabsProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>("sessions");
  const { hasChanges, totalNewPRs, totalNewIssues } = useGitHubChanges();

  // If GitHub not connected, just render the regular Sidebar
  if (!isGitHubConnected) {
    return <Sidebar {...sessionProps} />;
  }

  return (
    <div className="w-52 h-full flex flex-col bg-slate-900/50 backdrop-blur-md border-r border-white/5">
      {/* Tab Switcher */}
      <div className="flex border-b border-white/5">
        <TabButton
          active={activeTab === "sessions"}
          onClick={() => setActiveTab("sessions")}
          icon={Terminal}
          label="Sessions"
        />
        <TabButton
          active={activeTab === "repositories"}
          onClick={() => setActiveTab("repositories")}
          icon={Github}
          label="Repos"
          badge={hasChanges ? totalNewPRs + totalNewIssues : undefined}
        />
      </div>

      {/* Tab Content */}
      <div className="flex-1 min-h-0">
        {activeTab === "sessions" ? (
          <SessionsTabContent {...sessionProps} />
        ) : (
          <RepositoriesTab
            onCreatePRWorktree={onCreatePRWorktree}
            onOpenSettings={onGitHubSettings}
          />
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Tab Button Component
// =============================================================================

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: typeof Terminal;
  label: string;
  badge?: number;
}

function TabButton({ active, onClick, icon: Icon, label, badge }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 flex items-center justify-center gap-1.5 px-3 py-2",
        "text-xs font-medium transition-all duration-150",
        "border-b-2",
        active
          ? "border-violet-500 text-white bg-white/5"
          : "border-transparent text-slate-400 hover:text-white hover:bg-white/5"
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <ChangeIndicator count={badge} pulse size="sm" />
      )}
    </button>
  );
}

// =============================================================================
// Sessions Tab Content (wraps existing Sidebar content)
// =============================================================================

interface SessionsTabContentProps {
  sessions: TerminalSession[];
  folders: SessionFolder[];
  sessionFolders: Record<string, string>;
  activeSessionId: string | null;
  activeFolderId: string | null;
  folderHasPreferences: (folderId: string) => boolean;
  onSessionClick: (sessionId: string) => void;
  onSessionClose: (sessionId: string) => void;
  onSessionRename: (sessionId: string, newName: string) => void;
  onSessionMove: (sessionId: string, folderId: string | null) => void;
  onNewSession: () => void;
  onQuickNewSession: () => void;
  onFolderCreate: (name: string) => void;
  onFolderRename: (folderId: string, newName: string) => void;
  onFolderDelete: (folderId: string) => void;
  onFolderToggle: (folderId: string) => void;
  onFolderClick: (folderId: string) => void;
  onFolderSettings: (folderId: string, folderName: string) => void;
  onFolderNewSession: (folderId: string) => void;
}

function SessionsTabContent(props: SessionsTabContentProps) {
  // Render the Sidebar with noContainer=true to avoid nested containers
  return <Sidebar {...props} noContainer />;
}

// =============================================================================
// Export the original Sidebar for backwards compatibility
// =============================================================================

export { Sidebar } from "./Sidebar";
