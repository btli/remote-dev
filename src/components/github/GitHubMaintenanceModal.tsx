"use client";

/**
 * GitHubMaintenanceModal - Modal for managing GitHub connection and repositories
 *
 * Features:
 * - Account info display
 * - Repository list with management actions
 * - Force refresh, clear cache, disconnect
 */

import { useState, useMemo } from "react";
import {
  Github,
  RefreshCw,
  Trash2,
  LogOut,
  Loader2,
  FolderGit2,
  HardDrive,
  Clock,
  AlertCircle,
  ExternalLink,
  Search,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { CachedRepositoryCard } from "./CachedRepositoryCard";
import { cn } from "@/lib/utils";

interface GitHubMaintenanceModalProps {
  open: boolean;
  onClose: () => void;
}

export function GitHubMaintenanceModal({
  open,
  onClose,
}: GitHubMaintenanceModalProps) {
  const {
    isConnected,
    accountInfo,
    repositories,
    stats,
    loading,
    error,
    forceRefreshAll,
    deleteRepository,
    recloneRepository,
    disconnect,
  } = useGitHubContext();

  const [activeTab, setActiveTab] = useState<"repositories" | "settings">(
    "repositories"
  );
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

  const formatDate = (date: Date | null) => {
    if (!date) return "Never";
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  };

  // Disconnected state
  if (!isConnected) {
    return (
      <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <DialogContent className="sm:max-w-[450px] bg-popover/95 backdrop-blur-xl border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <Github className="w-5 h-5 text-primary" />
              Connect GitHub
            </DialogTitle>
            <DialogDescription>
              Connect your GitHub account to browse and clone repositories.
            </DialogDescription>
          </DialogHeader>

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
        </DialogContent>
      </Dialog>
    );
  }

  // Connected state
  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <DialogContent className="sm:max-w-[700px] max-h-[85vh] flex flex-col bg-popover/95 backdrop-blur-xl border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <Github className="w-5 h-5 text-primary" />
              GitHub Maintenance
            </DialogTitle>
            <DialogDescription>
              Manage your GitHub connection and cached repositories.
            </DialogDescription>
          </DialogHeader>

          {/* Error display */}
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <Tabs
            value={activeTab}
            onValueChange={(v) =>
              setActiveTab(v as "repositories" | "settings")
            }
            className="flex-1 flex flex-col min-h-0"
          >
            <TabsList className="grid w-full grid-cols-2 shrink-0">
              <TabsTrigger value="repositories">Repositories</TabsTrigger>
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
              <ScrollArea className="h-[300px]">
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
                      No repositories match "{searchQuery}"
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

            {/* Settings Tab */}
            <TabsContent value="settings" className="flex-1 mt-4">
              <div className="space-y-6">
                {/* Account info */}
                {accountInfo && (
                  <div className="p-4 rounded-lg border border-border bg-card/30">
                    <h3 className="text-sm font-medium text-foreground mb-3">
                      Connected Account
                    </h3>
                    <div className="flex items-center gap-3">
                      <img
                        src={accountInfo.avatarUrl}
                        alt={accountInfo.login}
                        className="w-12 h-12 rounded-full"
                      />
                      <div>
                        <p className="font-medium text-foreground">
                          {accountInfo.name || accountInfo.login}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          @{accountInfo.login}
                        </p>
                        {accountInfo.email && (
                          <p className="text-xs text-muted-foreground">
                            {accountInfo.email}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        onClick={() =>
                          window.open(
                            `https://github.com/${accountInfo.login}`,
                            "_blank"
                          )
                        }
                      >
                        <ExternalLink className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}

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
                        {stats.lastSync
                          ? formatDate(stats.lastSync)
                          : "Never"}
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
                          Disconnect GitHub
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Remove GitHub connection from your account
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
                        Disconnect
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Disconnect confirmation dialog */}
      <AlertDialog
        open={showDisconnectDialog}
        onOpenChange={setShowDisconnectDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect GitHub?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                This will remove your GitHub connection. You'll need to
                reconnect to access your repositories.
              </p>
              <label className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  checked={disconnectWithCache}
                  onChange={(e) => setDisconnectWithCache(e.target.checked)}
                  className="rounded border-border"
                />
                <span className="text-sm">Also clear cached repositories</span>
              </label>
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
