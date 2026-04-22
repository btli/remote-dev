"use client";

/**
 * FolderAccountBinder - Select which GitHub account a project should use.
 *
 * Shown inside the project preferences modal. Allows the user to bind
 * a specific GitHub account to a project, or use the default. The
 * `folderId` prop name is retained for now since the backing bindings
 * map on the context is still exposed under the legacy name, but the
 * value is a project id post-refactor.
 */

import { useState } from "react";
import Image from "next/image";
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
  projectId: string;
}

export function FolderAccountBinder({ projectId }: FolderAccountBinderProps) {
  const {
    accounts,
    folderBindings,
    bindProject,
    unbindProject,
    defaultAccount,
  } = useGitHubAccounts();

  const [saving, setSaving] = useState(false);

  const boundAccountId = folderBindings[projectId] ?? USE_DEFAULT;

  const handleChange = async (value: string) => {
    setSaving(true);
    try {
      if (value === USE_DEFAULT) {
        await unbindProject(projectId);
      } else {
        await bindProject(projectId, value);
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
                <Image
                  src={account.avatarUrl}
                  alt={account.login}
                  width={16}
                  height={16}
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
