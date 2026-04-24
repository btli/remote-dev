"use client";

/**
 * GitHubMaintenancePlugin (client half) — React rendering for the GitHub
 * maintenance tab (formerly `GitHubMaintenanceModal`).
 *
 * Hosts the original modal body — repositories list, accounts tab, cache
 * stats, disconnect affordance — without the Dialog wrapper so it renders
 * in the full workspace pane like other converted modals (issues, prs,
 * recordings, settings, profiles).
 *
 * @see ./github-maintenance-plugin-server.ts for lifecycle.
 * @see src/components/github/GitHubMaintenanceModal.tsx (deleted) for the
 *   original Dialog-wrapped UI.
 */

import { useState, useMemo } from "react";
import {
  Github,
  RefreshCw,
  LogOut,
  Loader2,
  FolderGit2,
  HardDrive,
  Clock,
  AlertCircle,
  Search,
  Wrench,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useGitHubContext } from "@/contexts/GitHubContext";
import { CachedRepositoryCard } from "@/components/github/CachedRepositoryCard";
import { AccountSwitcher } from "@/components/github/AccountSwitcher";
import { useGitHubAccounts } from "@/contexts/GitHubAccountContext";
import type {
  TerminalTypeClientPlugin,
  TerminalTypeClientComponentProps,
} from "@/types/terminal-type-client";
import type { TerminalSession } from "@/types/session";
import type { GitHubMaintenanceMetadata } from "./github-maintenance-plugin-server";

/**
 * Typed reader for maintenance session metadata.
 *
 * Returns null when the stored metadata is missing or malformed so the
 * component can render a graceful fallback instead of crashing on a bad
 * row. Mirrors the `readIssuesMetadata` / `readPRsMetadata` pattern.
 */
export function readGitHubMaintenanceMetadata(
  session: TerminalSession
): GitHubMaintenanceMetadata | null {
  const md =
    session.typeMetadata as Partial<GitHubMaintenanceMetadata> | null;
  if (!md || typeof md.repositoryId !== "string" || !md.repositoryId) {
    return null;
  }
  return {
    repositoryId: md.repositoryId,
    repositoryName:
      typeof md.repositoryName === "string" ? md.repositoryName : "",
    repositoryUrl:
      typeof md.repositoryUrl === "string" ? md.repositoryUrl : "",
  };
}

function formatDate(date: Date | null) {
  if (!date) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function GitHubMaintenanceTabContent({
  session,
}: TerminalTypeClientComponentProps) {
  const {
    isConnected,
    repositories,
    stats,
    loading,
    error,
    forceRefreshAll,
    deleteRepository,
    recloneRepository,
    disconnect,
  } = useGitHubContext();

  const { accounts: ghAccounts } = useGitHubAccounts();
  const metadata = readGitHubMaintenanceMetadata(session);

  const [activeTab, setActiveTab] = useState<
    "repositories" | "accounts" | "settings"
  >("repositories");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [disconnectWithCache, setDisconnectWithCache] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Filter repositories based on search query
  const filteredRepositories = useMemo(() => {
    if (!searchQuery.trim()) {
      return repositories;
    }
    const query = searchQuery.toLowerCase();
    return repositories.filter(
      (repo) =>
        repo.name.toLowerCase().includes(query) ||
        repo.fullName.toLowerCase().includes(query)
    );
  }, [searchQuery, repositories]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await forceRefreshAll();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await disconnect(disconnectWithCache);
      setShowDisconnectDialog(false);
      // Reload page to update server-side state
      window.location.reload();
    } catch {
      setIsDisconnecting(false);
    }
  };

  const handleConnect = () => {
    window.location.href = "/api/auth/github/link";
  };

  if (!metadata) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <AlertCircle className="w-8 h-8 text-destructive mb-2" />
        <p className="text-sm text-destructive">
          Maintenance session is missing a repository binding.
        </p>
      </div>
    );
  }

  // Disconnected state (no accounts at all)
  if (!isConnected && ghAccounts.length === 0) {
    return (
      <div className="flex flex-col h-full min-h-0 overflow-hidden p-6">
        <div className="flex items-center gap-2 mb-2">
          <Github className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Connect GitHub</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          Connect your GitHub account to browse and clone repositories.
        </p>
        <div className="flex flex-col items-center py-8 gap-4">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
            <Github className="w-8 h-8 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground text-center">
            Your GitHub account is not connected.
            <br />
            Connect to access your repositories.
          </p>
          <Button onClick={handleConnect} className="gap-2">
            <Github className="w-4 h-4" />
            Connect GitHub
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col h-full min-h-0 overflow-hidden p-6">
        <div className="shrink-0">
          <div className="flex items-center gap-2">
            <Github className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">
              GitHub Maintenance
              {metadata.repositoryName && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  — {metadata.repositoryName}
                </span>
              )}
            </h2>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Manage your GitHub connection and cached repositories.
          </p>
        </div>

        {/* Error display */}
        {error && (
          <div className="mt-4 flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <Tabs
          value={activeTab}
          onValueChange={(v) =>
            setActiveTab(v as "repositories" | "accounts" | "settings")
          }
          className="flex-1 flex flex-col min-h-0 mt-4"
        >
          <TabsList className="grid w-full grid-cols-3 shrink-0">
            <TabsTrigger value="repositories">Repositories</TabsTrigger>
            <TabsTrigger value="accounts">
              Accounts
              {ghAccounts.length > 0 && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  ({ghAccounts.length})
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          {/* Repositories Tab */}
          <TabsContent
            value="repositories"
            className="flex-1 flex flex-col min-h-0 mt-4 space-y-4"
          >
            {/* Stats bar */}
            <div className="flex items-center justify-between gap-4 shrink-0">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <FolderGit2 className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    <strong className="text-foreground">
                      {stats.totalRepos}
                    </strong>{" "}
                    repos
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    <strong className="text-foreground">
                      {stats.clonedRepos}
                    </strong>{" "}
                    cloned ({stats.totalDiskSizeFormatted})
                  </span>
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshing || loading}
                className="gap-2"
              >
                {isRefreshing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                Refresh
              </Button>
            </div>

            {/* Search input */}
            <div className="relative shrink-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search repositories..."
                className="pl-10 bg-card/50 border-border focus:border-primary"
              />
            </div>

            {/* Repository list */}
            <ScrollArea className="flex-1 min-h-0">
              {loading && repositories.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : repositories.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2">
                  <FolderGit2 className="w-8 h-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    No repositories cached
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                  >
                    Fetch Repositories
                  </Button>
                </div>
              ) : filteredRepositories.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2">
                  <Search className="w-8 h-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    No repositories match &quot;{searchQuery}&quot;
                  </p>
                </div>
              ) : (
                <div className="space-y-2 pr-4">
                  {filteredRepositories.map((repo) => (
                    <CachedRepositoryCard
                      key={repo.id}
                      repository={repo}
                      onDelete={deleteRepository}
                      onClone={recloneRepository}
                      disabled={loading}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>

            {/* Last sync info */}
            {stats.lastSync && (
              <div className="flex items-center gap-2 pt-3 border-t border-border text-xs text-muted-foreground shrink-0">
                <Clock className="w-3 h-3" />
                Last synced: {formatDate(stats.lastSync)}
              </div>
            )}
          </TabsContent>

          {/* Accounts Tab */}
          <TabsContent value="accounts" className="flex-1 mt-4 min-h-0 overflow-y-auto">
            <AccountSwitcher />
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings" className="flex-1 mt-4 min-h-0 overflow-y-auto">
            <div className="space-y-6">
              {/* Cache stats */}
              <div className="p-4 rounded-lg border border-border bg-card/30">
                <h3 className="text-sm font-medium text-foreground mb-3">
                  Cache Statistics
                </h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Total Repositories</p>
                    <p className="text-lg font-semibold text-foreground">
                      {stats.totalRepos}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Cloned Locally</p>
                    <p className="text-lg font-semibold text-foreground">
                      {stats.clonedRepos}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Disk Usage</p>
                    <p className="text-lg font-semibold text-foreground">
                      {stats.totalDiskSizeFormatted}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Last Sync</p>
                    <p className="text-lg font-semibold text-foreground">
                      {stats.lastSync ? formatDate(stats.lastSync) : "Never"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Danger zone */}
              <div className="p-4 rounded-lg border border-destructive/30 bg-destructive/5">
                <h3 className="text-sm font-medium text-destructive mb-3">
                  Danger Zone
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Disconnect All Accounts
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Remove all GitHub accounts and optionally clear cached
                        repositories
                      </p>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        setDisconnectWithCache(false);
                        setShowDisconnectDialog(true);
                      }}
                    >
                      <LogOut className="w-4 h-4 mr-2" />
                      Disconnect All
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Disconnect confirmation dialog */}
      <AlertDialog
        open={showDisconnectDialog}
        onOpenChange={setShowDisconnectDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect All GitHub Accounts?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This will remove all linked GitHub accounts. You&apos;ll need
                  to reconnect to access your repositories.
                </p>
                <label className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    checked={disconnectWithCache}
                    onChange={(e) => setDisconnectWithCache(e.target.checked)}
                    className="rounded border-border"
                  />
                  <span className="text-sm">
                    Also clear cached repositories
                  </span>
                </label>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDisconnecting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              disabled={isDisconnecting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isDisconnecting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Disconnecting...
                </>
              ) : (
                "Disconnect"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Default GitHub maintenance client plugin instance. */
export const GitHubMaintenanceClientPlugin: TerminalTypeClientPlugin = {
  type: "github-maintenance",
  displayName: "GitHub Maintenance",
  description: "Manage GitHub connections and cached repositories",
  icon: Wrench,
  priority: 55,
  builtIn: true,
  component: GitHubMaintenanceTabContent,
  deriveTitle(session) {
    const md = readGitHubMaintenanceMetadata(session);
    return md?.repositoryName
      ? `Maintenance — ${md.repositoryName}`
      : null;
  },
};
