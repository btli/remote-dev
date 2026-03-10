"use client";

/**
 * AccountSwitcher - Manage linked GitHub accounts.
 *
 * Displays a list of linked accounts with actions:
 * - Set as default
 * - Unlink
 * - Add another account
 */

import { useState } from "react";
import Image from "next/image";
import {
  Github,
  Star,
  Trash2,
  Plus,
  Loader2,
  ExternalLink,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useGitHubAccounts, type LinkedGitHubAccount } from "@/contexts/GitHubAccountContext";

export function AccountSwitcher() {
  const {
    accounts,
    loading,
    error,
    setDefault,
    unlinkAccount,
    addAccount,
  } = useGitHubAccounts();

  const [unlinkTarget, setUnlinkTarget] = useState<LinkedGitHubAccount | null>(null);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const [settingDefault, setSettingDefault] = useState<string | null>(null);

  const handleSetDefault = async (providerAccountId: string) => {
    setSettingDefault(providerAccountId);
    try {
      await setDefault(providerAccountId);
    } finally {
      setSettingDefault(null);
    }
  };

  const handleUnlink = async () => {
    if (!unlinkTarget) return;
    setIsUnlinking(true);
    try {
      await unlinkAccount(unlinkTarget.providerAccountId);
      setUnlinkTarget(null);
    } finally {
      setIsUnlinking(false);
    }
  };

  if (loading && accounts.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {accounts.length === 0 ? (
          <div className="flex flex-col items-center py-8 gap-4">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
              <Github className="w-8 h-8 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground text-center">
              No GitHub accounts linked.
              <br />
              Add an account to get started.
            </p>
            <Button onClick={addAccount} className="gap-2">
              <Github className="w-4 h-4" />
              Connect GitHub Account
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {accounts.map((account) => (
                <div
                  key={account.providerAccountId}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card/30 hover:bg-card/50 transition-colors"
                >
                  <Image
                    src={account.avatarUrl}
                    alt={account.login}
                    width={40}
                    height={40}
                    className="w-10 h-10 rounded-full"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-foreground truncate">
                        {account.displayName || account.login}
                      </p>
                      {account.isDefault && (
                        <Badge variant="secondary" className="text-xs shrink-0">
                          Default
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">
                      @{account.login}
                      {account.email && ` · ${account.email}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {!account.isDefault && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleSetDefault(account.providerAccountId)}
                            disabled={settingDefault === account.providerAccountId}
                          >
                            {settingDefault === account.providerAccountId ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Star className="w-4 h-4" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Set as default</TooltipContent>
                      </Tooltip>
                    )}

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() =>
                            window.open(`https://github.com/${account.login}`, "_blank")
                          }
                        >
                          <ExternalLink className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>View on GitHub</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setUnlinkTarget(account)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Unlink account</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              ))}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={addAccount}
              className="gap-2 w-full"
            >
              <Plus className="w-4 h-4" />
              Add Another GitHub Account
            </Button>
          </>
        )}
      </div>

      {/* Unlink confirmation */}
      <AlertDialog
        open={!!unlinkTarget}
        onOpenChange={(open) => !open && setUnlinkTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlink GitHub Account?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the connection to{" "}
              <strong>@{unlinkTarget?.login}</strong>. Sessions using this
              account will fall back to the default account.
              {unlinkTarget?.isDefault && accounts.length > 1 && (
                <span className="block mt-2 text-amber-500">
                  This is your default account. Another account will be promoted
                  as the new default.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUnlinking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnlink}
              disabled={isUnlinking}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isUnlinking ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Unlinking...
                </>
              ) : (
                "Unlink"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
