import { sqliteTable, text, integer, primaryKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { AdapterAccountType } from "next-auth/adapters";
import type { SessionStatus } from "@/types/session";

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
  fontFamily: text("font_family").default("'JetBrains Mono', monospace"),
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
  ]
);
