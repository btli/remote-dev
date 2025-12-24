import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { AdapterAccountType } from "next-auth/adapters";
import type { SessionStatus } from "@/types/session";
import type { SplitDirection } from "@/types/split";
import type { CIStatusState, PRState } from "@/types/github-stats";
import type { ScheduleStatus, ExecutionStatus } from "@/types/schedule";

export const users = sqliteTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: integer("emailVerified", { mode: "timestamp_ms" }),
  image: text("image"),
});

export const accounts = sqliteTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
    // Index for faster lookup of user's OAuth accounts
    index("account_user_idx").on(account.userId),
  ]
);

export const sessions = sqliteTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
});

export const verificationTokens = sqliteTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
  },
  (verificationToken) => [
    primaryKey({
      columns: [verificationToken.identifier, verificationToken.token],
    }),
  ]
);

export const authorizedUsers = sqliteTable("authorized_user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// User settings for configurable options
export const userSettings = sqliteTable("user_settings", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  // Terminal preferences
  defaultWorkingDirectory: text("default_working_directory"),
  defaultShell: text("default_shell"),
  startupCommand: text("startup_command"),
  // Appearance preferences
  theme: text("theme").default("tokyo-night"),
  fontSize: integer("font_size").default(14),
  fontFamily: text("font_family").default("'JetBrainsMono Nerd Font Mono', monospace"),
  // Active project tracking
  activeFolderId: text("active_folder_id"),
  pinnedFolderId: text("pinned_folder_id"),
  autoFollowActiveSession: integer("auto_follow_active_session", { mode: "boolean" })
    .notNull()
    .default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// GitHub repository cache
export const githubRepositories = sqliteTable(
  "github_repository",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    githubId: integer("github_id").notNull(),
    name: text("name").notNull(),
    fullName: text("full_name").notNull(),
    cloneUrl: text("clone_url").notNull(),
    defaultBranch: text("default_branch").notNull(),
    localPath: text("local_path"),
    isPrivate: integer("is_private", { mode: "boolean" }).notNull().default(false),
    addedAt: integer("added_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("github_repo_user_idx").on(table.userId),
    index("github_repo_github_id_idx").on(table.userId, table.githubId),
  ]
);

// Session folders for organizing terminal sessions (supports nesting)
export const sessionFolders = sqliteTable(
  "session_folder",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    name: text("name").notNull(),
    collapsed: integer("collapsed", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("session_folder_user_idx").on(table.userId),
    index("session_folder_parent_idx").on(table.parentId),
  ]
);

// Folder-level preference overrides
export const folderPreferences = sqliteTable(
  "folder_preferences",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    folderId: text("folder_id")
      .notNull()
      .references(() => sessionFolders.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Terminal preferences (all nullable = inherit from user)
    defaultWorkingDirectory: text("default_working_directory"),
    defaultShell: text("default_shell"),
    startupCommand: text("startup_command"),
    // Appearance preferences
    theme: text("theme"),
    fontSize: integer("font_size"),
    fontFamily: text("font_family"),
    // Repository association for worktree support
    githubRepoId: text("github_repo_id").references(() => githubRepositories.id, {
      onDelete: "set null",
    }),
    localRepoPath: text("local_repo_path"), // Alternative: manual path to local git repo
    // Environment variables as JSON: { "PORT": "3000", "API_URL": "..." }
    // Use "__DISABLED__" value to explicitly disable an inherited variable
    environmentVars: text("environment_vars"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("folder_prefs_folder_user_idx").on(table.folderId, table.userId),
    index("folder_prefs_user_idx").on(table.userId),
  ]
);

// Port registry for environment variable port conflict detection
export const portRegistry = sqliteTable(
  "port_registry",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    folderId: text("folder_id")
      .notNull()
      .references(() => sessionFolders.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    port: integer("port").notNull(),
    variableName: text("variable_name").notNull(), // e.g., "PORT", "DB_PORT"
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("port_registry_user_idx").on(table.userId),
    index("port_registry_folder_idx").on(table.folderId),
    // Composite index for fast conflict detection
    index("port_registry_user_port_idx").on(table.userId, table.port),
  ]
);

// Split groups for terminal split panes
export const splitGroups = sqliteTable(
  "split_group",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    direction: text("direction").$type<SplitDirection>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("split_group_user_idx").on(table.userId)]
);

// Session templates for reusable configurations
export const sessionTemplates = sqliteTable(
  "session_template",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    // Template settings
    sessionNamePattern: text("session_name_pattern"), // e.g., "Dev Server - ${n}"
    projectPath: text("project_path"),
    startupCommand: text("startup_command"),
    folderId: text("folder_id").references(() => sessionFolders.id, {
      onDelete: "set null",
    }),
    icon: text("icon"), // lucide icon name
    // Appearance overrides
    theme: text("theme"),
    fontSize: integer("font_size"),
    fontFamily: text("font_family"),
    // Usage tracking
    usageCount: integer("usage_count").notNull().default(0),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("session_template_user_idx").on(table.userId),
    index("session_template_usage_idx").on(table.userId, table.usageCount),
  ]
);

// Session recordings for playback
export const sessionRecordings = sqliteTable(
  "session_recording",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id"), // Optional: link to original session
    name: text("name").notNull(),
    description: text("description"),
    // Recording metadata
    duration: integer("duration").notNull(), // Duration in milliseconds
    terminalCols: integer("terminal_cols").notNull().default(80),
    terminalRows: integer("terminal_rows").notNull().default(24),
    // Recording data as JSON: { events: [{ t: number, d: string }] }
    data: text("data").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("session_recording_user_idx").on(table.userId),
    index("session_recording_created_idx").on(table.userId, table.createdAt),
  ]
);

// API keys for programmatic access (Agent API)
export const apiKeys = sqliteTable(
  "api_key",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // User-friendly name (e.g., "CI Pipeline", "Orchestrator Agent")
    keyPrefix: text("key_prefix").notNull(), // First 8 chars for identification (e.g., "rdv_abc1")
    keyHash: text("key_hash").notNull(), // SHA-256 hash of the full key
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }), // Optional expiration
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("api_key_user_idx").on(table.userId),
    index("api_key_prefix_idx").on(table.keyPrefix), // Fast lookup by prefix
  ]
);

// Terminal sessions with tmux persistence
export const terminalSessions = sqliteTable(
  "terminal_session",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tmuxSessionName: text("tmux_session_name").notNull().unique(),
    projectPath: text("project_path"),
    githubRepoId: text("github_repo_id").references(() => githubRepositories.id, {
      onDelete: "set null",
    }),
    worktreeBranch: text("worktree_branch"),
    folderId: text("folder_id").references(() => sessionFolders.id, {
      onDelete: "set null",
    }),
    // Split group membership (independent from folder)
    splitGroupId: text("split_group_id").references(() => splitGroups.id, {
      onDelete: "set null",
    }),
    splitOrder: integer("split_order").notNull().default(0),
    splitSize: real("split_size").default(0.5),
    status: text("status").$type<SessionStatus>().notNull().default("active"),
    tabOrder: integer("tab_order").notNull().default(0),
    lastActivityAt: integer("last_activity_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("terminal_session_user_status_idx").on(table.userId, table.status),
    index("terminal_session_user_order_idx").on(table.userId, table.tabOrder),
    index("terminal_session_split_group_idx").on(table.splitGroupId),
  ]
);

// Trash items - generic container for any trashable resource
export const trashItems = sqliteTable(
  "trash_item",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    resourceType: text("resource_type").notNull(), // "worktree" | future types
    resourceId: text("resource_id").notNull(), // Original resource ID (e.g., session ID)
    resourceName: text("resource_name").notNull(), // Display name
    trashedAt: integer("trashed_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)), // 30 days
  },
  (table) => [
    index("trash_item_user_type_idx").on(table.userId, table.resourceType),
    index("trash_item_expires_idx").on(table.expiresAt),
    index("trash_item_resource_idx").on(table.resourceType, table.resourceId),
  ]
);

// Worktree-specific trash metadata
export const worktreeTrashMetadata = sqliteTable(
  "worktree_trash_metadata",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    trashItemId: text("trash_item_id")
      .notNull()
      .unique()
      .references(() => trashItems.id, { onDelete: "cascade" }),
    // Repository context
    githubRepoId: text("github_repo_id").references(() => githubRepositories.id, {
      onDelete: "set null",
    }),
    repoName: text("repo_name").notNull(),
    repoLocalPath: text("repo_local_path").notNull(),
    // Worktree details
    worktreeBranch: text("worktree_branch").notNull(),
    worktreeOriginalPath: text("worktree_original_path").notNull(),
    worktreeTrashPath: text("worktree_trash_path").notNull(),
    // Folder organization (snapshot at trash time)
    originalFolderId: text("original_folder_id"),
    originalFolderName: text("original_folder_name"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("worktree_trash_repo_idx").on(table.githubRepoId),
  ]
);

// =============================================================================
// GitHub Stats Tables
// =============================================================================

// Repository stats cache - stores aggregated stats from GitHub API
export const githubRepositoryStats = sqliteTable(
  "github_repository_stats",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    repositoryId: text("repository_id")
      .notNull()
      .unique()
      .references(() => githubRepositories.id, { onDelete: "cascade" }),
    openPRCount: integer("open_pr_count").notNull().default(0),
    openIssueCount: integer("open_issue_count").notNull().default(0),
    ciStatus: text("ci_status").$type<CIStatusState>(),
    ciStatusDetails: text("ci_status_details"), // JSON: { totalCount, successCount, failureCount, pendingCount }
    branchProtected: integer("branch_protected", { mode: "boolean" }).notNull().default(false),
    branchProtectionDetails: text("branch_protection_details"), // JSON: BranchProtection object
    recentCommits: text("recent_commits"), // JSON array of CommitInfo
    cachedAt: integer("cached_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date(Date.now() + 15 * 60 * 1000)), // 15 minutes default TTL
  },
  (table) => [
    index("github_repo_stats_repo_idx").on(table.repositoryId),
    index("github_repo_stats_expires_idx").on(table.expiresAt),
  ]
);

// Pull requests cache - stores open PRs for quick display
export const githubPullRequests = sqliteTable(
  "github_pull_request",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => githubRepositories.id, { onDelete: "cascade" }),
    prNumber: integer("pr_number").notNull(),
    title: text("title").notNull(),
    state: text("state").$type<PRState>().notNull(),
    branch: text("branch").notNull(),
    baseBranch: text("base_branch").notNull(),
    author: text("author").notNull(),
    authorAvatarUrl: text("author_avatar_url"),
    url: text("url").notNull(),
    isDraft: integer("is_draft", { mode: "boolean" }).notNull().default(false),
    additions: integer("additions").notNull().default(0),
    deletions: integer("deletions").notNull().default(0),
    reviewDecision: text("review_decision").$type<"APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED">(),
    ciStatus: text("ci_status").$type<CIStatusState>(),
    isNew: integer("is_new", { mode: "boolean" }).notNull().default(false), // New since last user view
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    cachedAt: integer("cached_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("github_pr_repo_idx").on(table.repositoryId),
    index("github_pr_repo_number_idx").on(table.repositoryId, table.prNumber),
    index("github_pr_state_idx").on(table.repositoryId, table.state),
  ]
);

// Branch protection rules cache
export const githubBranchProtection = sqliteTable(
  "github_branch_protection",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => githubRepositories.id, { onDelete: "cascade" }),
    branch: text("branch").notNull(),
    isProtected: integer("is_protected", { mode: "boolean" }).notNull().default(false),
    requiresReview: integer("requires_review", { mode: "boolean" }).notNull().default(false),
    requiredReviewers: integer("required_reviewers").notNull().default(0),
    requiresStatusChecks: integer("requires_status_checks", { mode: "boolean" }).notNull().default(false),
    requiredChecks: text("required_checks"), // JSON array of check names
    allowsForcePushes: integer("allows_force_pushes", { mode: "boolean" }).notNull().default(false),
    allowsDeletions: integer("allows_deletions", { mode: "boolean" }).notNull().default(false),
    cachedAt: integer("cached_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("github_branch_protection_repo_branch_idx").on(table.repositoryId, table.branch),
  ]
);

// Folder to repository mapping - links folders to their source repos
export const folderRepositories = sqliteTable(
  "folder_repository",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    folderId: text("folder_id")
      .notNull()
      .references(() => sessionFolders.id, { onDelete: "cascade" }),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => githubRepositories.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("folder_repo_folder_user_idx").on(table.folderId, table.userId),
    index("folder_repo_user_idx").on(table.userId),
  ]
);

// GitHub stats display preferences per user/folder
export const githubStatsPreferences = sqliteTable(
  "github_stats_preferences",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    folderId: text("folder_id").references(() => sessionFolders.id, { onDelete: "cascade" }), // null = global user preference
    showPRCount: integer("show_pr_count", { mode: "boolean" }).notNull().default(true),
    showIssueCount: integer("show_issue_count", { mode: "boolean" }).notNull().default(true),
    showCIStatus: integer("show_ci_status", { mode: "boolean" }).notNull().default(true),
    showRecentCommits: integer("show_recent_commits", { mode: "boolean" }).notNull().default(true),
    showBranchProtection: integer("show_branch_protection", { mode: "boolean" }).notNull().default(true),
    refreshIntervalMinutes: integer("refresh_interval_minutes").notNull().default(15),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    // User can have one global preference (folderId null) and one per folder
    uniqueIndex("github_stats_prefs_user_folder_idx").on(table.userId, table.folderId),
    index("github_stats_prefs_user_idx").on(table.userId),
  ]
);

// Change notifications tracking - tracks unseen changes per repo per user
export const githubChangeNotifications = sqliteTable(
  "github_change_notification",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => githubRepositories.id, { onDelete: "cascade" }),
    newPRCount: integer("new_pr_count").notNull().default(0),
    newIssueCount: integer("new_issue_count").notNull().default(0),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("github_notifications_user_repo_idx").on(table.userId, table.repositoryId),
    index("github_notifications_user_idx").on(table.userId),
  ]
);

// =============================================================================
// Scheduled Commands Tables
// =============================================================================

/**
 * Scheduled command execution for terminal sessions.
 * Supports cron-based scheduling with timezone awareness.
 */
export const sessionSchedules = sqliteTable(
  "session_schedule",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => terminalSessions.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // User-friendly name (e.g., "Daily Git Sync")
    cronExpression: text("cron_expression").notNull(), // Full cron syntax: "0 9 * * 1-5"
    timezone: text("timezone").notNull().default("America/Los_Angeles"), // IANA timezone
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    status: text("status").$type<ScheduleStatus>().notNull().default("active"),
    // Execution control
    maxRetries: integer("max_retries").notNull().default(0), // 0 = no retries
    retryDelaySeconds: integer("retry_delay_seconds").notNull().default(60),
    timeoutSeconds: integer("timeout_seconds").notNull().default(300), // 5 min default
    // Execution tracking
    lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
    lastRunStatus: text("last_run_status").$type<ExecutionStatus>(),
    nextRunAt: integer("next_run_at", { mode: "timestamp_ms" }), // Cached for UI display
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("session_schedule_user_idx").on(table.userId),
    index("session_schedule_session_idx").on(table.sessionId),
    index("session_schedule_next_run_idx").on(table.enabled, table.nextRunAt),
  ]
);

/**
 * Individual commands within a schedule.
 * Executed sequentially with optional delays between commands.
 */
export const scheduleCommands = sqliteTable(
  "schedule_command",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => sessionSchedules.id, { onDelete: "cascade" }),
    command: text("command").notNull(), // Shell command to execute
    order: integer("order").notNull(), // Execution order (0-based)
    delayBeforeSeconds: integer("delay_before_seconds").notNull().default(0), // Wait before running
    continueOnError: integer("continue_on_error", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("schedule_command_schedule_idx").on(table.scheduleId),
    index("schedule_command_order_idx").on(table.scheduleId, table.order),
  ]
);

/**
 * Execution history for audit and debugging.
 * Stores output, errors, and timing for each run.
 */
export const scheduleExecutions = sqliteTable(
  "schedule_execution",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => sessionSchedules.id, { onDelete: "cascade" }),
    status: text("status").$type<ExecutionStatus>().notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    // Execution details
    commandCount: integer("command_count").notNull(),
    successCount: integer("success_count").notNull(),
    failureCount: integer("failure_count").notNull(),
    // Error tracking
    errorMessage: text("error_message"),
    // Output storage (optional, can be large)
    output: text("output"), // Combined stdout/stderr (truncated to 10KB)
  },
  (table) => [
    index("schedule_execution_schedule_idx").on(table.scheduleId),
    index("schedule_execution_started_idx").on(table.scheduleId, table.startedAt),
  ]
);

/**
 * Per-command execution results within a schedule run.
 * Detailed tracking for multi-command schedules.
 */
export const commandExecutions = sqliteTable(
  "command_execution",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    executionId: text("execution_id")
      .notNull()
      .references(() => scheduleExecutions.id, { onDelete: "cascade" }),
    commandId: text("command_id")
      .notNull()
      .references(() => scheduleCommands.id, { onDelete: "cascade" }),
    command: text("command").notNull(), // Snapshot of command (in case it changes)
    status: text("status").$type<ExecutionStatus>().notNull(),
    exitCode: integer("exit_code"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    output: text("output"), // Truncated to 5KB per command
    errorMessage: text("error_message"),
  },
  (table) => [
    index("command_execution_execution_idx").on(table.executionId),
    index("command_execution_command_idx").on(table.commandId),
  ]
);
