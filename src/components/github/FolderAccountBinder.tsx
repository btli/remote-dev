"use client";

/**
 * FolderAccountBinder - Select which GitHub account a folder should use.
 *
 * Shown inside FolderPreferencesModal. Allows the user to bind
 * a specific GitHub account to a folder, or use the default.
 */

import { useState } from "react";
import { Github, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useGitHubAccounts } from "@/contexts/GitHubAccountContext";

const USE_DEFAULT = "__default__";

interface FolderAccountBinderProps {
  folderId: string;
}

export function FolderAccountBinder({ folderId }: FolderAccountBinderProps) {
  const {
    accounts,
    folderBindings,
    bindFolder,
    unbindFolder,
    defaultAccount,
  } = useGitHubAccounts();

  const [saving, setSaving] = useState(false);

  const boundAccountId = folderBindings[folderId] ?? USE_DEFAULT;

  const handleChange = async (value: string) => {
    setSaving(true);
    try {
      if (value === USE_DEFAULT) {
        await unbindFolder(folderId);
      } else {
        await bindFolder(folderId, value);
      }
    } finally {
      setSaving(false);
    }
  };

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No GitHub accounts linked. Connect an account in GitHub settings.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Github className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">
          GitHub Account
        </span>
        {saving && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
      </div>
      <Select value={boundAccountId} onValueChange={handleChange} disabled={saving}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select account" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={USE_DEFAULT}>
            <span className="flex items-center gap-2">
              Use Default
              {defaultAccount && (
                <span className="text-muted-foreground text-xs">
                  (@{defaultAccount.login})
                </span>
              )}
            </span>
          </SelectItem>
          {accounts.map((account) => (
            <SelectItem
              key={account.providerAccountId}
              value={account.providerAccountId}
            >
              <span className="flex items-center gap-2">
                <img
                  src={account.avatarUrl}
                  alt={account.login}
                  className="w-4 h-4 rounded-full"
                />
                @{account.login}
                {account.isDefault && (
                  <span className="text-muted-foreground text-xs">(default)</span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Sessions in this folder will use the selected account for GitHub operations and <code>gh</code> CLI auth.
      </p>
    </div>
  );
}
