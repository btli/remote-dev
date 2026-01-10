import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { AdapterAccountType } from "next-auth/adapters";
import type { SessionStatus } from "@/types/session";
import type { SplitDirection } from "@/types/split";
import type { CIStatusState, PRState } from "@/types/github-stats";
import type { ScheduleType, ScheduleStatus, ExecutionStatus } from "@/types/schedule";
import type { AgentProvider, AgentConfigType, MCPTransport } from "@/types/agent";
import type { AgentProviderType } from "@/types/session";
import type { AppearanceMode, ColorSchemeCategory, ColorSchemeId } from "@/types/appearance";
import type { EnrichmentStatusType, ProjectCategoryType, ProgrammingLanguageType } from "@/types/project-metadata";

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
  // Scrollback buffer settings (for performance tuning)
  // xterm.js client-side scrollback (default: 10000 lines)
  xtermScrollback: integer("xterm_scrollback").default(10000),
  // tmux server-side history-limit (default: 50000 lines)
  tmuxHistoryLimit: integer("tmux_history_limit").default(50000),
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
  // Feature flags
  orchestratorFirstMode: integer("orchestrator_first_mode", { mode: "boolean" })
    .notNull()
    .default(false),
  // Master Control orchestrator settings
  // Directory where Master Control runs (default: ~/.remote-dev/projects)
  masterControlDirectory: text("master_control_directory"),
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
    path: text("path"), // Filesystem path for folder-based orchestration
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
    // Composite index for building folder hierarchies (used in tree views)
    index("session_folder_user_parent_idx").on(table.userId, table.parentId),
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
    // Feature flags (nullable for inheritance)
    orchestratorFirstMode: integer("orchestrator_first_mode", { mode: "boolean" }),
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

// Folder-level secrets provider configuration
export const folderSecretsConfig = sqliteTable(
  "folder_secrets_config",
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
    provider: text("provider").notNull(), // "phase" | "vault" | "aws-secrets-manager" | "1password"
    // Provider-specific config as JSON:
    // Phase: { "app": "my-app", "env": "development", "serviceToken": "pss_..." }
    // Vault: { "url": "https://vault.example.com", "path": "secret/data/myapp", "token": "..." }
    providerConfig: text("provider_config").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastFetchedAt: integer("last_fetched_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("folder_secrets_config_folder_user_idx").on(table.folderId, table.userId),
    index("folder_secrets_config_user_idx").on(table.userId),
    // Index for fetching all enabled configs for a user (used in secrets status checks)
    index("folder_secrets_config_user_enabled_idx").on(table.userId, table.enabled),
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
    // Agent profile for environment isolation
    profileId: text("profile_id").references(() => agentProfiles.id, {
      onDelete: "set null",
    }),
    // Agent-aware session: which AI agent is associated
    agentProvider: text("agent_provider").$type<AgentProviderType>().default("claude"),
    // Orchestrator flag: marks sessions running orchestrator agents
    isOrchestratorSession: integer("is_orchestrator_session", { mode: "boolean" })
      .notNull()
      .default(false),
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
    // Composite index for filtering sessions by folder (used in folder views)
    index("terminal_session_user_folder_idx").on(table.userId, table.folderId),
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

// GitHub Issues cache - stores issue details from GitHub API
export const githubIssues = sqliteTable(
  "github_issue",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => githubRepositories.id, { onDelete: "cascade" }),
    issueNumber: integer("issue_number").notNull(),
    title: text("title").notNull(),
    state: text("state").$type<"open" | "closed">().notNull(),
    body: text("body"),
    htmlUrl: text("html_url").notNull(),
    author: text("author"), // JSON: { login, avatarUrl }
    labels: text("labels").notNull().default("[]"), // JSON array: [{ name, color }]
    assignees: text("assignees").notNull().default("[]"), // JSON array: [{ login, avatarUrl }]
    milestone: text("milestone"), // JSON: { title, number }
    comments: integer("comments").notNull().default(0),
    isNew: integer("is_new", { mode: "boolean" }).notNull().default(false), // New since last user view
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    cachedAt: integer("cached_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("github_issue_repo_idx").on(table.repositoryId),
    uniqueIndex("github_issue_repo_number_idx").on(table.repositoryId, table.issueNumber),
    index("github_issue_state_idx").on(table.repositoryId, table.state),
    index("github_issue_cached_idx").on(table.cachedAt),
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
    scheduleType: text("schedule_type").$type<ScheduleType>().notNull().default("one-time"),
    cronExpression: text("cron_expression"), // Full cron syntax: "0 9 * * 1-5" (null for one-time)
    scheduledAt: integer("scheduled_at", { mode: "timestamp_ms" }), // For one-time schedules
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

/**
 * Setup configuration for first-run wizard.
 * Stores app-wide configuration set during initial setup.
 */
export const setupConfig = sqliteTable("setup_config", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  // Directory and ports
  workingDirectory: text("working_directory").notNull(),
  nextPort: integer("next_port").notNull().default(3000),
  terminalPort: integer("terminal_port").notNull().default(3001),
  // WSL configuration (Windows only)
  wslDistribution: text("wsl_distribution"),
  // Startup options
  autoStart: integer("auto_start", { mode: "boolean" }).notNull().default(true),
  checkForUpdates: integer("check_for_updates", { mode: "boolean" })
    .notNull()
    .default(true),
  // Setup status
  isComplete: integer("is_complete", { mode: "boolean" }).notNull().default(false),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// =============================================================================
// Agent Management Tables
// =============================================================================

/**
 * Agent profiles for managing isolated AI agent configurations.
 * Each profile has its own config directory with isolated credentials and settings.
 */
export const agentProfiles = sqliteTable(
  "agent_profile",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    provider: text("provider").$type<AgentProvider>().notNull().default("all"),
    configDir: text("config_dir").notNull(), // ~/.remote-dev/profiles/{id}/
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("agent_profile_user_idx").on(table.userId),
    index("agent_profile_default_idx").on(table.userId, table.isDefault),
  ]
);

/**
 * Agent configuration files (CLAUDE.md, AGENTS.md, GEMINI.md) stored per folder.
 * Supports inheritance: global (null folderId) -> folder-specific.
 */
export const agentConfigs = sqliteTable(
  "agent_config",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    folderId: text("folder_id").references(() => sessionFolders.id, {
      onDelete: "cascade",
    }),
    provider: text("provider").$type<AgentProvider>().notNull(),
    configType: text("config_type").$type<AgentConfigType>().notNull(),
    content: text("content").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("agent_config_user_idx").on(table.userId),
    index("agent_config_folder_idx").on(table.folderId),
    // Unique constraint: one config per provider/type per folder per user
    uniqueIndex("agent_config_unique_idx").on(
      table.userId,
      table.folderId,
      table.provider,
      table.configType
    ),
  ]
);

/**
 * MCP server configurations for AI agent tool access.
 * Supports global (null folderId) and folder-specific servers.
 */
export const mcpServers = sqliteTable(
  "mcp_server",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    folderId: text("folder_id").references(() => sessionFolders.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    transport: text("transport").$type<MCPTransport>().notNull().default("stdio"),
    command: text("command").notNull(),
    args: text("args").notNull().default("[]"), // JSON array
    env: text("env").notNull().default("{}"), // JSON object
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    autoStart: integer("auto_start", { mode: "boolean" }).notNull().default(false),
    lastHealthCheck: integer("last_health_check", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("mcp_server_user_idx").on(table.userId),
    index("mcp_server_folder_idx").on(table.folderId),
    index("mcp_server_enabled_idx").on(table.userId, table.enabled),
  ]
);

/**
 * Links folders to specific agent profiles.
 * When a session is created in a folder, it uses the linked profile's environment.
 */
export const folderProfileLinks = sqliteTable(
  "folder_profile_link",
  {
    folderId: text("folder_id")
      .primaryKey()
      .references(() => sessionFolders.id, { onDelete: "cascade" }),
    profileId: text("profile_id")
      .notNull()
      .references(() => agentProfiles.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("folder_profile_link_profile_idx").on(table.profileId)]
);

/**
 * Git identity configurations per agent profile.
 * Stores user.name, user.email, SSH key paths, etc.
 */
export const profileGitIdentities = sqliteTable(
  "profile_git_identity",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    profileId: text("profile_id")
      .notNull()
      .unique()
      .references(() => agentProfiles.id, { onDelete: "cascade" }),
    userName: text("user_name").notNull(),
    userEmail: text("user_email").notNull(),
    sshKeyPath: text("ssh_key_path"), // Path to private key
    gpgKeyId: text("gpg_key_id"), // For commit signing
    githubUsername: text("github_username"), // For OAuth token lookup
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("profile_git_identity_profile_idx").on(table.profileId)]
);

/**
 * Profile-level secrets provider configuration for API keys.
 * Stores credentials like ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY
 * that are injected into sessions using this profile.
 */
export const profileSecretsConfig = sqliteTable(
  "profile_secrets_config",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    profileId: text("profile_id")
      .notNull()
      .unique()
      .references(() => agentProfiles.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // "phase" | "vault" | "aws-secrets-manager" | "1password"
    // Provider-specific config as JSON:
    // Phase: { "app": "my-app", "env": "development", "serviceToken": "pss_..." }
    providerConfig: text("provider_config").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastFetchedAt: integer("last_fetched_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("profile_secrets_config_profile_idx").on(table.profileId),
    index("profile_secrets_config_user_idx").on(table.userId),
  ]
);

/**
 * Discovered MCP tools from connected servers.
 * Cached to avoid repeated discovery calls.
 */
export const mcpDiscoveredTools = sqliteTable(
  "mcp_discovered_tool",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    serverId: text("server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    inputSchema: text("input_schema"), // JSON Schema
    discoveredAt: integer("discovered_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("mcp_discovered_tool_server_idx").on(table.serverId),
    uniqueIndex("mcp_discovered_tool_unique_idx").on(table.serverId, table.name),
  ]
);

/**
 * Discovered MCP resources from connected servers.
 * Cached to avoid repeated discovery calls.
 */
export const mcpDiscoveredResources = sqliteTable(
  "mcp_discovered_resource",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    serverId: text("server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
    uri: text("uri").notNull(),
    name: text("name"),
    description: text("description"),
    mimeType: text("mime_type"),
    discoveredAt: integer("discovered_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("mcp_discovered_resource_server_idx").on(table.serverId),
    uniqueIndex("mcp_discovered_resource_unique_idx").on(table.serverId, table.uri),
  ]
);

/**
 * Agent activity events for analytics and dashboard.
 * Tracks session starts, commands, errors, and other events.
 */
export const agentActivityEvents = sqliteTable(
  "agent_activity_event",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => terminalSessions.id, {
      onDelete: "set null",
    }),
    agentProvider: text("agent_provider").$type<AgentProviderType>(),
    eventType: text("event_type").notNull(), // "session_start" | "session_end" | "command" | "error" | "tool_call"
    eventData: text("event_data"), // JSON with event-specific data
    duration: integer("duration"), // Duration in milliseconds (for timed events)
    success: integer("success", { mode: "boolean" }),
    errorMessage: text("error_message"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("agent_activity_user_idx").on(table.userId),
    index("agent_activity_session_idx").on(table.sessionId),
    index("agent_activity_provider_idx").on(table.userId, table.agentProvider),
    index("agent_activity_event_type_idx").on(table.userId, table.eventType),
    index("agent_activity_created_idx").on(table.userId, table.createdAt),
  ]
);

/**
 * Daily aggregated stats for faster dashboard queries.
 * Updated periodically from activity events.
 */
export const agentDailyStats = sqliteTable(
  "agent_daily_stats",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // YYYY-MM-DD format
    agentProvider: text("agent_provider").$type<AgentProviderType>(),
    sessionCount: integer("session_count").notNull().default(0),
    commandCount: integer("command_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    totalDuration: integer("total_duration").notNull().default(0), // Total session duration in ms
    toolCallCount: integer("tool_call_count").notNull().default(0),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("agent_daily_stats_unique_idx").on(
      table.userId,
      table.date,
      table.agentProvider
    ),
    index("agent_daily_stats_user_date_idx").on(table.userId, table.date),
  ]
);

/**
 * Session memory for cross-session context persistence.
 * Stores notes, artifacts, and summaries that persist between sessions.
 */
export const sessionMemory = sqliteTable(
  "session_memory",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    folderId: text("folder_id").references(() => sessionFolders.id, {
      onDelete: "set null",
    }),
    type: text("type").$type<"note" | "artifact" | "summary">().notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    tags: text("tags").notNull().default("[]"), // JSON array
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("session_memory_user_idx").on(table.userId),
    index("session_memory_folder_idx").on(table.folderId),
    index("session_memory_type_idx").on(table.userId, table.type),
  ]
);

// =============================================================================
// Appearance System Tables
// =============================================================================

/**
 * Color scheme definitions for site-wide theming.
 * Stores both built-in and custom color schemes.
 */
export const colorSchemes = sqliteTable(
  "color_scheme",
  {
    id: text("id").$type<ColorSchemeId>().primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category").$type<ColorSchemeCategory>().notNull(),
    // JSON-encoded color definitions: { light: ModePalette, dark: ModePalette }
    colorDefinitions: text("color_definitions").notNull(),
    // Optional terminal palette override (JSON)
    terminalPalette: text("terminal_palette"),
    isBuiltIn: integer("is_built_in", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("color_scheme_category_idx").on(table.category),
    index("color_scheme_sort_idx").on(table.sortOrder),
  ]
);

/**
 * User appearance settings for site-wide theming.
 * Stores mode preference, color scheme selections, and terminal appearance options.
 */
export const appearanceSettings = sqliteTable(
  "appearance_settings",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    // Mode preference: light, dark, or system (follows OS)
    appearanceMode: text("appearance_mode")
      .$type<AppearanceMode>()
      .notNull()
      .default("system"),
    // Color scheme for light mode
    lightColorScheme: text("light_color_scheme")
      .$type<ColorSchemeId>()
      .notNull()
      .default("ocean"),
    // Color scheme for dark mode
    darkColorScheme: text("dark_color_scheme")
      .$type<ColorSchemeId>()
      .notNull()
      .default("midnight"),
    // Terminal appearance settings
    terminalOpacity: integer("terminal_opacity").notNull().default(100), // 0-100
    terminalBlur: integer("terminal_blur").notNull().default(0), // px
    terminalCursorStyle: text("terminal_cursor_style")
      .$type<"block" | "underline" | "bar">()
      .notNull()
      .default("block"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("appearance_settings_user_idx").on(table.userId),
  ]
);

/**
 * Agent JSON configuration storage per profile.
 * Stores full JSON configuration for each CLI agent (Claude Code, Gemini, OpenCode, Codex).
 * Each profile can have separate configs for each agent type.
 */
export const agentProfileJsonConfigs = sqliteTable(
  "agent_profile_json_config",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    profileId: text("profile_id")
      .notNull()
      .references(() => agentProfiles.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentType: text("agent_type")
      .$type<Exclude<AgentProvider, "all">>()
      .notNull(), // "claude" | "gemini" | "opencode" | "codex"
    // Full JSON configuration for the agent
    // Structure varies by agent type - see types/agent-config.ts
    configJson: text("config_json").notNull().default("{}"),
    // Validation status
    isValid: integer("is_valid", { mode: "boolean" }).notNull().default(true),
    validationErrors: text("validation_errors"), // JSON array of error messages
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("agent_profile_json_config_profile_idx").on(table.profileId),
    index("agent_profile_json_config_user_idx").on(table.userId),
    // Unique: one config per agent type per profile
    uniqueIndex("agent_profile_json_config_unique_idx").on(
      table.profileId,
      table.agentType
    ),
  ]
);

/**
 * Agent profile appearance settings.
 * Allows each agent profile to have its own theme/color preferences.
 * Falls back to user's appearance settings when not specified.
 */
export const profileAppearanceSettings = sqliteTable(
  "profile_appearance_settings",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    profileId: text("profile_id")
      .notNull()
      .unique()
      .references(() => agentProfiles.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Mode preference: light, dark, or system (follows OS)
    appearanceMode: text("appearance_mode")
      .$type<AppearanceMode>()
      .notNull()
      .default("system"),
    // Color scheme for light mode
    lightColorScheme: text("light_color_scheme")
      .$type<ColorSchemeId>()
      .notNull()
      .default("ocean"),
    // Color scheme for dark mode
    darkColorScheme: text("dark_color_scheme")
      .$type<ColorSchemeId>()
      .notNull()
      .default("midnight"),
    // Terminal appearance settings
    terminalOpacity: integer("terminal_opacity").notNull().default(100), // 0-100
    terminalBlur: integer("terminal_blur").notNull().default(0), // px
    terminalCursorStyle: text("terminal_cursor_style")
      .$type<"block" | "underline" | "bar">()
      .notNull()
      .default("block"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("profile_appearance_profile_idx").on(table.profileId),
    index("profile_appearance_user_idx").on(table.userId),
  ]
);

// Orchestrator sessions - special terminal sessions that monitor other sessions
export const orchestratorSessions = sqliteTable(
  "orchestrator_session",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Link to the underlying terminal session
    sessionId: text("session_id")
      .notNull()
      .unique()
      .references(() => terminalSessions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Orchestrator type: master (root-level) or sub_orchestrator (folder-scoped)
    type: text("type").notNull(), // 'master' | 'sub_orchestrator'
    // Orchestrator status
    status: text("status").notNull().default("idle"), // 'idle' | 'analyzing' | 'acting' | 'paused'
    // Scope for sub-orchestrators
    scopeType: text("scope_type"), // 'folder' | null (null for master)
    scopeId: text("scope_id"), // folder_id for sub-orchestrators, null for master
    // Custom instructions for this orchestrator
    customInstructions: text("custom_instructions"),
    // Monitoring configuration
    monitoringInterval: integer("monitoring_interval").notNull().default(30), // seconds
    stallThreshold: integer("stall_threshold").notNull().default(300), // seconds (5 minutes)
    autoIntervention: integer("auto_intervention", { mode: "boolean" })
      .notNull()
      .default(false),
    // Timestamps
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
    // Index for user's orchestrators
    index("orchestrator_session_user_idx").on(table.userId),
    // Index for scope lookup
    index("orchestrator_session_scope_idx").on(table.scopeType, table.scopeId),
    // Index for status filtering
    index("orchestrator_session_status_idx").on(table.status),
    // Index for type filtering
    index("orchestrator_session_type_idx").on(table.type),
    // COMPOSITE INDEX for active orchestrator queries (userId, status)
    // Optimizes: SELECT * FROM orchestrator_sessions WHERE userId = ? AND status = 'idle'
    index("orchestrator_session_user_status_idx").on(table.userId, table.status),
    // UNIQUE CONSTRAINTS to prevent duplicate orchestrators (prevents race conditions)
    // NOTE: The master uniqueness constraint is created via raw SQL partial index in migration
    // because drizzle-orm doesn't support partial indexes natively.
    // The partial index: CREATE UNIQUE INDEX orchestrator_session_master_unique ON orchestrator_session (user_id) WHERE type = 'master'
    // Ensure only one sub-orchestrator per folder (scopeId is folder_id for sub-orchestrators)
    // For masters (scopeId=null), SQLite treats null as distinct so this doesn't affect them
    uniqueIndex("orchestrator_session_scope_unique").on(table.userId, table.scopeId),
  ]
);

// Orchestrator insights - generated observations about sessions
export const orchestratorInsights = sqliteTable(
  "orchestrator_insight",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Which orchestrator generated this insight
    orchestratorId: text("orchestrator_id")
      .notNull()
      .references(() => orchestratorSessions.id, { onDelete: "cascade" }),
    // Target session (if insight is session-specific)
    sessionId: text("session_id").references(() => terminalSessions.id, {
      onDelete: "cascade",
    }),
    // Insight classification
    type: text("type").notNull(), // 'stall_detected' | 'performance' | 'error' | 'suggestion'
    severity: text("severity").notNull(), // 'info' | 'warning' | 'error' | 'critical'
    // Insight content
    message: text("message").notNull(),
    contextJson: text("context_json"), // Additional structured context
    suggestedActions: text("suggested_actions"), // JSON array of action suggestions
    // Resolution tracking
    resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    // Timestamps
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    // Index for orchestrator's insights
    index("orchestrator_insight_orchestrator_idx").on(table.orchestratorId),
    // Index for session's insights
    index("orchestrator_insight_session_idx").on(table.sessionId),
    // Index for unresolved insights
    index("orchestrator_insight_resolved_idx").on(table.resolved),
    // Index for severity filtering
    index("orchestrator_insight_severity_idx").on(table.severity),
    // Composite index for querying by type and severity
    index("orchestrator_insight_type_severity_idx").on(table.type, table.severity),
  ]
);

// Orchestrator audit log - immutable record of all orchestrator actions
export const orchestratorAuditLog = sqliteTable(
  "orchestrator_audit_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Which orchestrator performed the action
    orchestratorId: text("orchestrator_id")
      .notNull()
      .references(() => orchestratorSessions.id, { onDelete: "cascade" }),
    // Action classification
    actionType: text("action_type").notNull(), // 'insight_generated' | 'command_injected' | 'session_monitored' | 'status_changed'
    // Target session (if action is session-specific)
    targetSessionId: text("target_session_id").references(() => terminalSessions.id, {
      onDelete: "set null",
    }),
    // Action details (JSON)
    detailsJson: text("details_json"),
    // Immutable timestamp
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    // Index for orchestrator's log entries
    index("orchestrator_audit_orchestrator_idx").on(table.orchestratorId),
    // Index for time-ordered queries
    index("orchestrator_audit_time_idx").on(table.createdAt),
    // Index for action type filtering
    index("orchestrator_audit_action_idx").on(table.actionType),
    // Index for target session lookup
    index("orchestrator_audit_target_idx").on(table.targetSessionId),
    // COMPOSITE INDEX for time-range queries (orchestratorId, createdAt)
    // Optimizes: SELECT * FROM audit_log WHERE orchestratorId = ? AND createdAt >= ? AND createdAt <= ?
    index("orchestrator_audit_orchestrator_time_idx").on(table.orchestratorId, table.createdAt),
  ]
);

// =============================================================================
// Project Metadata Tables
// =============================================================================

/**
 * Project metadata - enriched information about projects/folders.
 * Stores detected tech stack, dependencies, build config, and agent hints.
 * Used by orchestrators for intelligent monitoring and suggestions.
 */
export const projectMetadata = sqliteTable(
  "project_metadata",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Link to folder (one metadata per folder)
    folderId: text("folder_id")
      .notNull()
      .unique()
      .references(() => sessionFolders.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Project root path (may differ from folder preferences)
    projectPath: text("project_path").notNull(),

    // Enrichment status tracking
    enrichmentStatus: text("enrichment_status")
      .$type<EnrichmentStatusType>()
      .notNull()
      .default("pending"),
    enrichedAt: integer("enriched_at", { mode: "timestamp_ms" }),
    lastEnrichmentError: text("last_enrichment_error"),

    // Project classification
    category: text("category")
      .$type<ProjectCategoryType>()
      .notNull()
      .default("unknown"),
    primaryLanguage: text("primary_language").$type<ProgrammingLanguageType>(),
    // JSON array of detected languages
    languages: text("languages").notNull().default("[]"),
    framework: text("framework"),

    // Project structure flags
    isMonorepo: integer("is_monorepo", { mode: "boolean" }).notNull().default(false),
    hasTypeScript: integer("has_typescript", { mode: "boolean" }).notNull().default(false),
    hasDocker: integer("has_docker", { mode: "boolean" }).notNull().default(false),
    hasCI: integer("has_ci", { mode: "boolean" }).notNull().default(false),

    // Dependency information (JSON arrays)
    dependencies: text("dependencies").notNull().default("[]"),
    devDependencies: text("dev_dependencies").notNull().default("[]"),
    dependencyCount: integer("dependency_count").notNull().default(0),
    devDependencyCount: integer("dev_dependency_count").notNull().default(0),

    // Build configuration
    packageManager: text("package_manager"), // npm, yarn, pnpm, bun, pip, uv, cargo, go
    // JSON: { tool, configFile, scripts }
    buildTool: text("build_tool"),
    // JSON: { framework, configFile, hasUnitTests, hasIntegrationTests, hasE2ETests }
    testFramework: text("test_framework"),
    // JSON: { provider, hasTests, hasLinting, hasBuild, hasDeploy, workflows }
    cicd: text("cicd"),

    // Git information (JSON)
    git: text("git"),

    // File statistics
    totalFiles: integer("total_files").notNull().default(0),
    sourceFiles: integer("source_files").notNull().default(0),
    testFiles: integer("test_files").notNull().default(0),
    configFiles: integer("config_files").notNull().default(0),

    // Agent hints
    // JSON array of suggested startup commands
    suggestedStartupCommands: text("suggested_startup_commands").notNull().default("[]"),
    suggestedAgentInstructions: text("suggested_agent_instructions"),

    // Timestamps
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    // Index for user's metadata
    index("project_metadata_user_idx").on(table.userId),
    // Index for enrichment status (for batch refresh queries)
    index("project_metadata_status_idx").on(table.enrichmentStatus),
    // Composite index for user + status (refresh stale metadata for user)
    index("project_metadata_user_status_idx").on(table.userId, table.enrichmentStatus),
    // Index for path lookups
    index("project_metadata_path_idx").on(table.projectPath),
  ]
);

// =============================================================================
// Orchestrator Task Management Tables
// =============================================================================

/**
 * Task status values.
 * queued → planning → executing → monitoring → completed/failed/cancelled
 */
export type TaskStatusType =
  | "queued"
  | "planning"
  | "executing"
  | "monitoring"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Task type values - determines agent selection and context injection.
 */
export type TaskTypeType =
  | "feature"
  | "bug"
  | "refactor"
  | "test"
  | "documentation"
  | "research"
  | "review"
  | "maintenance";

/**
 * Delegation status values.
 * spawning → injecting_context → running → monitoring → completed/failed
 */
export type DelegationStatusType =
  | "spawning"
  | "injecting_context"
  | "running"
  | "monitoring"
  | "completed"
  | "failed";

/**
 * Tasks - Orchestrator task queue and lifecycle tracking.
 * A task is a unit of work delegated by an orchestrator to an agent session.
 * Integrates with beads for issue tracking.
 */
export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Link to orchestrator that owns this task
    orchestratorId: text("orchestrator_id")
      .notNull()
      .references(() => orchestratorSessions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Optional folder scope (null = orchestrator-wide)
    folderId: text("folder_id").references(() => sessionFolders.id, {
      onDelete: "set null",
    }),

    // Task description (natural language)
    description: text("description").notNull(),
    // Task type for agent selection
    type: text("type").$type<TaskTypeType>().notNull().default("feature"),
    // Task lifecycle status
    status: text("status").$type<TaskStatusType>().notNull().default("queued"),

    // Confidence score from parsing (0-1)
    confidence: real("confidence").notNull().default(1.0),
    // Estimated duration in seconds
    estimatedDuration: integer("estimated_duration"),

    // Assigned agent provider (claude, codex, gemini, opencode)
    assignedAgent: text("assigned_agent").$type<AgentProviderType>(),
    // Link to active delegation
    delegationId: text("delegation_id"),
    // Link to beads issue (e.g., "beads-abc123")
    beadsIssueId: text("beads_issue_id"),

    // Context injected into the agent session
    contextInjected: text("context_injected"),

    // Task result (JSON: { success, summary, filesModified, learnings })
    resultJson: text("result_json"),
    // Task error (JSON: { code, message, stack?, recoverable })
    errorJson: text("error_json"),

    // Timestamps
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    // Index for orchestrator's tasks
    index("tasks_orchestrator_idx").on(table.orchestratorId),
    // Index for user's tasks
    index("tasks_user_idx").on(table.userId),
    // Index for folder's tasks
    index("tasks_folder_idx").on(table.folderId),
    // Index for status filtering
    index("tasks_status_idx").on(table.status),
    // Index for beads issue lookup
    index("tasks_beads_idx").on(table.beadsIssueId),
    // COMPOSITE INDEX for orchestrator + status (fetch active tasks)
    index("tasks_orchestrator_status_idx").on(table.orchestratorId, table.status),
    // COMPOSITE INDEX for user + status (fetch user's active tasks)
    index("tasks_user_status_idx").on(table.userId, table.status),
  ]
);

/**
 * Delegations - Links tasks to sessions for execution.
 * Tracks the execution lifecycle including context injection, logs, and results.
 */
export const delegations = sqliteTable(
  "delegations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Link to parent task
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    // Link to terminal session executing the task
    sessionId: text("session_id")
      .notNull()
      .references(() => terminalSessions.id, { onDelete: "cascade" }),
    // Optional worktree for isolation
    worktreeId: text("worktree_id"),

    // Agent provider running the task
    agentProvider: text("agent_provider").$type<AgentProviderType>().notNull(),
    // Delegation lifecycle status
    status: text("status")
      .$type<DelegationStatusType>()
      .notNull()
      .default("spawning"),

    // Context injected into the session
    contextInjected: text("context_injected"),
    // Execution logs (JSON array: [{ timestamp, level, message, metadata? }])
    executionLogsJson: text("execution_logs_json").notNull().default("[]"),

    // Delegation result (JSON: { success, summary, exitCode, filesModified, duration, tokenUsage })
    resultJson: text("result_json"),
    // Delegation error (JSON: { code, message, exitCode, recoverable })
    errorJson: text("error_json"),

    // Path to session transcript file
    transcriptPath: text("transcript_path"),

    // Timestamps
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    // Index for task's delegations
    index("delegations_task_idx").on(table.taskId),
    // Index for session's delegations
    index("delegations_session_idx").on(table.sessionId),
    // Index for status filtering
    index("delegations_status_idx").on(table.status),
    // Index for agent filtering
    index("delegations_agent_idx").on(table.agentProvider),
    // COMPOSITE INDEX for task + status
    index("delegations_task_status_idx").on(table.taskId, table.status),
  ]
);

// =============================================================================
// Project Knowledge Tables (Self-Improvement)
// =============================================================================

/**
 * Convention category values for project knowledge.
 */
export type ConventionCategoryType =
  | "code_style"
  | "naming"
  | "architecture"
  | "testing"
  | "git"
  | "other";

/**
 * Learned pattern type values.
 */
export type PatternTypeType = "success" | "failure" | "gotcha" | "optimization";

/**
 * Skill scope values.
 */
export type SkillScopeType = "project" | "global";

/**
 * ProjectKnowledge - Stores learned knowledge about a project/folder.
 * Used by orchestrators for intelligent agent selection and context injection.
 * Enables self-improvement through pattern learning.
 */
export const projectKnowledge = sqliteTable(
  "project_knowledge",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Link to folder (one knowledge entry per folder)
    folderId: text("folder_id")
      .notNull()
      .unique()
      .references(() => sessionFolders.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // Tech stack (JSON array of technology names)
    techStackJson: text("tech_stack_json").notNull().default("[]"),

    // Conventions (JSON array: [{ id, category, description, examples, confidence, source, createdAt }])
    conventionsJson: text("conventions_json").notNull().default("[]"),

    // Agent performance metrics (JSON: { [taskType]: { [agent]: { successRate, avgDuration, totalTasks } } })
    agentPerformanceJson: text("agent_performance_json").notNull().default("{}"),

    // Learned patterns (JSON array: [{ id, type, description, context, confidence, usageCount, lastUsedAt, createdAt }])
    patternsJson: text("patterns_json").notNull().default("[]"),

    // Skills (JSON array: [{ id, name, description, command, steps, triggers, scope, verified, usageCount, createdAt }])
    skillsJson: text("skills_json").notNull().default("[]"),

    // Tools (JSON array: [{ id, name, description, inputSchema, implementation, triggers, confidence, verified, createdAt }])
    toolsJson: text("tools_json").notNull().default("[]"),

    // Project metadata (JSON: { projectName, projectPath, framework, packageManager, testRunner, linter, buildTool })
    metadataJson: text("metadata_json").notNull().default("{}"),

    // Last time the project was scanned for metadata
    lastScannedAt: integer("last_scanned_at", { mode: "timestamp_ms" }),

    // Timestamps
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    // Index for user's knowledge entries
    index("project_knowledge_user_idx").on(table.userId),
    // Index for staleness checks
    index("project_knowledge_scanned_idx").on(table.lastScannedAt),
  ]
);
