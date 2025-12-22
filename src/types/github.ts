/**
 * Git repository types for multi-vendor repository management and OAuth
 */

import type { GitProvider } from "@/db/schema";

// Re-export GitProvider for convenience
export type { GitProvider } from "@/db/schema";

export interface GitHubRepository {
  id: number;
  name: string;
  fullName: string;
  cloneUrl: string;
  sshUrl: string;
  defaultBranch: string;
  isPrivate: boolean;
  description: string | null;
  updatedAt: Date;
  language: string | null;
  stargazersCount: number;
  forksCount: number;
  provider: GitProvider;
  owner: {
    login: string;
    avatarUrl: string;
  };
}

export interface CachedGitHubRepository {
  id: string;
  userId: string;
  githubId: number;
  provider: GitProvider;
  name: string;
  fullName: string;
  cloneUrl: string;
  defaultBranch: string;
  localPath: string | null;
  isPrivate: boolean;
  addedAt: Date;
  updatedAt: Date;
}

export interface GitHubRepoFromAPI {
  id: number;
  name: string;
  full_name: string;
  clone_url: string;
  ssh_url: string;
  default_branch: string;
  private: boolean;
  description: string | null;
  updated_at: string;
  language: string | null;
  stargazers_count: number;
  owner: {
    login: string;
    avatar_url: string;
  };
}

export interface GitHubBranch {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  protected: boolean;
}

export interface FolderNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FolderNode[];
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  commit: string;
  isLocked: boolean;
  isPrunable: boolean;
}

export interface BranchInfo {
  name: string;
  isRemote: boolean;
  isDefault: boolean;
}

export interface CloneResult {
  success: boolean;
  localPath: string;
  error?: string;
}

export interface WorktreeResult {
  success: boolean;
  worktreePath: string;
  branch: string;
  error?: string;
}
