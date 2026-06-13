// Source-of-truth schema definition (neutral, dialect-agnostic).
//
// This file is HAND-MAINTAINED. Edit it to change the schema, then run
// `bun run db:codegen` to regenerate src/db/schema.sqlite.ts, src/db/schema.pg.ts
// and the src/db/schema.ts barrel. The structural snapshot (scripts/
// schema-structural-snapshot.ts) proves the generated SQLite schema is
// behavior-identical to the historical hand-written schema.
//
// NOTE: the type-import block below is reused VERBATIM by the generator so the
// emitted dialect files carry the same `.$type<X>()` brands as before.
import type { AdapterAccountType } from "next-auth/adapters";
import type { SessionStatus } from "@/types/session";
import type { CIStatusState, PRState } from "@/types/github-stats";
import type { ScheduleType, ScheduleStatus, ExecutionStatus } from "@/types/schedule";
import type { AgentProvider, AgentConfigType, MCPTransport } from "@/types/agent";
import type { AgentProviderType, WorktreeType } from "@/types/session";
import type { TerminalType, AgentExitState } from "@/types/terminal-type";
import type { AppearanceMode, ColorSchemeCategory, ColorSchemeId } from "@/types/appearance";
import type { TaskPriority, TaskStatus, TaskSource } from "@/types/task";
import type { NotificationType, NotificationSeverity, NotificationMeta } from "@/types/notification";
import type { ChannelType } from "@/types/channels";
// [oyej] Automation-platform schema brands (epic remote-dev-oyej).
import type { AgentRunStatus, AgentRunSource, TriggerKind } from "@/types/agent-run";
import type { CrownRunStatus } from "@/types/crown";
// Server-to-server project migration schema brands.
import type { MigrationJobStatus, MigrationImportStatus, MigrationWorkingTreeMode } from "@/types/migration";
// Claude profile usage-limit / pool schema brands (epic remote-dev-3b3l).
import type { ClaudeAccountKind, ClaudeLimitStatus, UsageDetectionSource, ClaudeAutoRelaunchMode } from "@/types/claude-limits";

// Re-exported so the verbatim import block above (consumed by the codegen extractor) is not flagged as unused.
export type { AdapterAccountType, SessionStatus, CIStatusState, PRState, ScheduleType, ScheduleStatus, ExecutionStatus, AgentProvider, AgentConfigType, MCPTransport, AgentProviderType, WorktreeType, TerminalType, AgentExitState, AppearanceMode, ColorSchemeCategory, ColorSchemeId, TaskPriority, TaskStatus, TaskSource, NotificationType, NotificationSeverity, NotificationMeta, ChannelType, AgentRunStatus, AgentRunSource, TriggerKind, CrownRunStatus, MigrationJobStatus, MigrationImportStatus, MigrationWorkingTreeMode, ClaudeAccountKind, ClaudeLimitStatus, UsageDetectionSource, ClaudeAutoRelaunchMode };

// DSL vocabulary lives in the shared generator core so both this app and the
// supervisor app describe their schemas with one set of types. Re-exported here
// for local use + back-compat. (This import is intentionally BELOW the verbatim
// brand-import block above so the codegen extractor — which stops at the first
// `export type` — does not copy it into the generated dialect files.)
import type {
  ColumnKind,
  DefaultValue,
  DefaultFn,
  DefaultRaw,
  ColumnDefault,
  ColumnReference,
  ColumnDefinition,
  IndexDefinition,
  TableDefinition,
  SchemaDefinition,
} from "../../scripts/lib/schema-codegen";

export type {
  ColumnKind,
  DefaultValue,
  DefaultFn,
  DefaultRaw,
  ColumnDefault,
  ColumnReference,
  ColumnDefinition,
  IndexDefinition,
  TableDefinition,
  SchemaDefinition,
};

export const schema: SchemaDefinition = [
  {
    exportName: "users",
    sqlName: "user",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "name", dbName: "name", kind: "text" },
      { field: "email", dbName: "email", kind: "text", unique: true },
      { field: "emailVerified", dbName: "emailVerified", kind: "timestampMs" },
      { field: "image", dbName: "image", kind: "text" },
    ],
  },
  {
    exportName: "userEmails",
    sqlName: "user_email",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "email", dbName: "email", kind: "text", notNull: true, unique: true },
      { field: "isPrimary", dbName: "is_primary", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      // SQLite keeps this explicit named index (matches the live DBs). On PG the
      // column-level `unique` on `email` already creates an identically-named
      // backing index, so emit it only for SQLite to avoid a 42P07 collision.
      { name: "user_email_email_unique", columns: ["email"], unique: true, omitForPg: true },
      { name: "user_email_user_idx", columns: ["userId"] },
    ],
  },
  {
    exportName: "accounts",
    sqlName: "account",
    columns: [
      { field: "userId", dbName: "userId", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "type", dbName: "type", kind: "text", notNull: true, typeBrand: "AdapterAccountType" },
      { field: "provider", dbName: "provider", kind: "text", notNull: true },
      { field: "providerAccountId", dbName: "providerAccountId", kind: "text", notNull: true },
      { field: "refresh_token", dbName: "refresh_token", kind: "text" },
      { field: "access_token", dbName: "access_token", kind: "text" },
      { field: "expires_at", dbName: "expires_at", kind: "integer" },
      { field: "token_type", dbName: "token_type", kind: "text" },
      { field: "scope", dbName: "scope", kind: "text" },
      { field: "id_token", dbName: "id_token", kind: "text" },
      { field: "session_state", dbName: "session_state", kind: "text" },
    ],
    primaryKey: ["provider","providerAccountId"],
    indexes: [
      { name: "account_user_idx", columns: ["userId"] },
    ],
  },
  {
    exportName: "sessions",
    sqlName: "session",
    columns: [
      { field: "sessionToken", dbName: "sessionToken", kind: "text", primaryKey: true },
      { field: "userId", dbName: "userId", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "expires", dbName: "expires", kind: "timestampMs", notNull: true },
    ],
  },
  {
    exportName: "verificationTokens",
    sqlName: "verificationToken",
    columns: [
      { field: "identifier", dbName: "identifier", kind: "text", notNull: true },
      { field: "token", dbName: "token", kind: "text", notNull: true },
      { field: "expires", dbName: "expires", kind: "timestampMs", notNull: true },
    ],
    primaryKey: ["identifier","token"],
  },
  {
    exportName: "authorizedUsers",
    sqlName: "authorized_user",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "email", dbName: "email", kind: "text", notNull: true, unique: true },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
  },
  {
    exportName: "userSettings",
    sqlName: "user_settings",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, unique: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "defaultWorkingDirectory", dbName: "default_working_directory", kind: "text" },
      { field: "defaultShell", dbName: "default_shell", kind: "text" },
      { field: "startupCommand", dbName: "startup_command", kind: "text" },
      { field: "xtermScrollback", dbName: "xterm_scrollback", kind: "integer", default: { kind: "value", value: "10000" } },
      { field: "tmuxHistoryLimit", dbName: "tmux_history_limit", kind: "integer", default: { kind: "value", value: "50000" } },
      { field: "theme", dbName: "theme", kind: "text", default: { kind: "value", value: "\"tokyo-night\"" } },
      { field: "fontSize", dbName: "font_size", kind: "integer", default: { kind: "value", value: "14" } },
      { field: "fontFamily", dbName: "font_family", kind: "text", default: { kind: "value", value: "\"'JetBrainsMono Nerd Font Mono', monospace\"" } },
      { field: "activeNodeId", dbName: "active_node_id", kind: "text" },
      { field: "activeNodeType", dbName: "active_node_type", kind: "text", enumValues: ["group","project"] },
      { field: "pinnedNodeId", dbName: "pinned_node_id", kind: "text" },
      { field: "pinnedNodeType", dbName: "pinned_node_type", kind: "text", enumValues: ["group","project"] },
      { field: "autoFollowActiveSession", dbName: "auto_follow_active_session", kind: "boolean", notNull: true, default: { kind: "value", value: "true" } },
      { field: "notificationsEnabled", dbName: "notifications_enabled", kind: "boolean", notNull: true, default: { kind: "value", value: "true" } },
      { field: "defaultAgentProvider", dbName: "default_agent_provider", kind: "text" },
      { field: "agentProviderSettings", dbName: "agent_provider_settings", kind: "json" },
      { field: "beadsSidebarCollapsed", dbName: "beads_sidebar_collapsed", kind: "boolean", notNull: true, default: { kind: "value", value: "true" } },
      { field: "beadsSidebarWidth", dbName: "beads_sidebar_width", kind: "integer", default: { kind: "value", value: "320" } },
      { field: "beadsClosedRetentionDays", dbName: "beads_closed_retention_days", kind: "integer", default: { kind: "value", value: "7" } },
      { field: "beadsSectionExpanded", dbName: "beads_section_expanded", kind: "text" },
      // Global default for what to do when a running Claude session hits a usage
      // limit (per-project override lives on node_preferences). [remote-dev-3b3l]
      { field: "claudeAutoRelaunchMode", dbName: "claude_auto_relaunch_mode", kind: "text", notNull: true, typeBrand: "ClaudeAutoRelaunchMode", default: { kind: "value", value: "\"notify\"" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
  },
  {
    exportName: "githubRepositories",
    sqlName: "github_repository",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "githubId", dbName: "github_id", kind: "integer", notNull: true },
      { field: "name", dbName: "name", kind: "text", notNull: true },
      { field: "fullName", dbName: "full_name", kind: "text", notNull: true },
      { field: "cloneUrl", dbName: "clone_url", kind: "text", notNull: true },
      { field: "defaultBranch", dbName: "default_branch", kind: "text", notNull: true },
      { field: "localPath", dbName: "local_path", kind: "text" },
      { field: "isPrivate", dbName: "is_private", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "addedAt", dbName: "added_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "github_repo_user_idx", columns: ["userId"] },
      { name: "github_repo_github_id_idx", columns: ["userId","githubId"] },
    ],
  },
  {
    exportName: "githubAccountMetadata",
    sqlName: "github_account_metadata",
    columns: [
      { field: "providerAccountId", dbName: "provider_account_id", kind: "text", primaryKey: true },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "login", dbName: "login", kind: "text", notNull: true },
      { field: "displayName", dbName: "display_name", kind: "text" },
      { field: "avatarUrl", dbName: "avatar_url", kind: "text", notNull: true },
      { field: "email", dbName: "email", kind: "text" },
      { field: "isDefault", dbName: "is_default", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "configDir", dbName: "config_dir", kind: "text", notNull: true },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "github_account_metadata_user_idx", columns: ["userId"] },
    ],
  },
  {
    exportName: "portRegistry",
    sqlName: "port_registry",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "projectId", dbName: "project_id", kind: "text", references: { table: "projects", column: "id", onDelete: "cascade" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "port", dbName: "port", kind: "integer", notNull: true },
      { field: "variableName", dbName: "variable_name", kind: "text", notNull: true },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "port_registry_user_idx", columns: ["userId"] },
      { name: "port_registry_project_idx", columns: ["projectId"] },
      { name: "port_registry_user_port_idx", columns: ["userId","port"] },
      { name: "port_registry_user_port_var_unique", columns: ["userId","port","variableName"], unique: true },
    ],
  },
  {
    exportName: "portClaims",
    sqlName: "port_claim",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "sessionId", dbName: "session_id", kind: "text", notNull: true, references: { table: "terminalSessions", column: "id", onDelete: "cascade" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "projectId", dbName: "project_id", kind: "text", references: { table: "projects", column: "id", onDelete: "cascade" } },
      { field: "port", dbName: "port", kind: "integer", notNull: true },
      { field: "variableName", dbName: "variable_name", kind: "text", notNull: true },
      { field: "isListening", dbName: "is_listening", kind: "boolean" },
      { field: "pid", dbName: "pid", kind: "integer" },
      { field: "expiresAt", dbName: "expires_at", kind: "timestampMs", notNull: true },
      { field: "claimedAt", dbName: "claimed_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "port_claim_session_idx", columns: ["sessionId"] },
      { name: "port_claim_user_idx", columns: ["userId"] },
      { name: "port_claim_port_idx", columns: ["port"] },
      { name: "port_claim_session_port_unique", columns: ["sessionId","port"], unique: true },
    ],
  },
  {
    exportName: "sessionTemplates",
    sqlName: "session_template",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "name", dbName: "name", kind: "text", notNull: true },
      { field: "description", dbName: "description", kind: "text" },
      { field: "sessionNamePattern", dbName: "session_name_pattern", kind: "text" },
      { field: "projectPath", dbName: "project_path", kind: "text" },
      { field: "startupCommand", dbName: "startup_command", kind: "text" },
      { field: "projectId", dbName: "project_id", kind: "text", references: { table: "projects", column: "id", onDelete: "set null" } },
      { field: "icon", dbName: "icon", kind: "text" },
      { field: "theme", dbName: "theme", kind: "text" },
      { field: "fontSize", dbName: "font_size", kind: "integer" },
      { field: "fontFamily", dbName: "font_family", kind: "text" },
      { field: "usageCount", dbName: "usage_count", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "lastUsedAt", dbName: "last_used_at", kind: "timestampMs" },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "session_template_user_idx", columns: ["userId"] },
      { name: "session_template_usage_idx", columns: ["userId","usageCount"] },
      { name: "session_template_project_idx", columns: ["projectId"] },
    ],
  },
  {
    exportName: "sessionRecordings",
    sqlName: "session_recording",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "sessionId", dbName: "session_id", kind: "text" },
      { field: "name", dbName: "name", kind: "text", notNull: true },
      { field: "description", dbName: "description", kind: "text" },
      { field: "duration", dbName: "duration", kind: "integer", notNull: true },
      { field: "terminalCols", dbName: "terminal_cols", kind: "integer", notNull: true, default: { kind: "value", value: "80" } },
      { field: "terminalRows", dbName: "terminal_rows", kind: "integer", notNull: true, default: { kind: "value", value: "24" } },
      { field: "data", dbName: "data", kind: "text", notNull: true },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "session_recording_user_idx", columns: ["userId"] },
      { name: "session_recording_created_idx", columns: ["userId","createdAt"] },
    ],
  },
  {
    exportName: "apiKeys",
    sqlName: "api_key",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "name", dbName: "name", kind: "text", notNull: true },
      { field: "keyPrefix", dbName: "key_prefix", kind: "text", notNull: true },
      { field: "keyHash", dbName: "key_hash", kind: "text", notNull: true },
      { field: "lastUsedAt", dbName: "last_used_at", kind: "timestampMs" },
      { field: "expiresAt", dbName: "expires_at", kind: "timestampMs" },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "api_key_user_idx", columns: ["userId"] },
      { name: "api_key_prefix_idx", columns: ["keyPrefix"] },
    ],
  },
  // [aehq] Centralized model-key proxy: scoped, revocable, per-session tokens
  // (`mp_…`) that authenticate calls to /api/model-proxy. Hash-at-rest, modeled
  // on api_key above.
  {
    exportName: "modelProxyTokens",
    sqlName: "model_proxy_token",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      // Session this token is scoped to (revoked when the session closes).
      { field: "sessionId", dbName: "session_id", kind: "text", references: { table: "terminalSessions", column: "id", onDelete: "cascade" } },
      // Supervisor instance slug for multi-tenant cost attribution (nullable single-tenant).
      { field: "instanceSlug", dbName: "instance_slug", kind: "text" },
      { field: "tokenPrefix", dbName: "token_prefix", kind: "text", notNull: true },
      { field: "tokenHash", dbName: "token_hash", kind: "text", notNull: true },
      // Which providers this token may proxy. JSON array string, e.g. '["anthropic"]'.
      { field: "providerScope", dbName: "provider_scope", kind: "text", notNull: true, default: { kind: "value", value: "\"[\\\"anthropic\\\"]\"" } },
      { field: "revokedAt", dbName: "revoked_at", kind: "timestampMs" },
      { field: "expiresAt", dbName: "expires_at", kind: "timestampMs" },
      { field: "lastUsedAt", dbName: "last_used_at", kind: "timestampMs" },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "model_proxy_token_prefix_idx", columns: ["tokenPrefix"] },
      { name: "model_proxy_token_session_idx", columns: ["sessionId"] },
      { name: "model_proxy_token_user_idx", columns: ["userId"] },
    ],
  },
  // [aehq] Centralized model-key proxy: per-call token/cost usage events for
  // observability + central billing, attributed by session / user / instance.
  {
    exportName: "modelUsageEvents",
    sqlName: "model_usage_event",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true },
      { field: "sessionId", dbName: "session_id", kind: "text" },
      { field: "instanceSlug", dbName: "instance_slug", kind: "text" },
      { field: "provider", dbName: "provider", kind: "text", notNull: true },
      { field: "model", dbName: "model", kind: "text" },
      { field: "inputTokens", dbName: "input_tokens", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "outputTokens", dbName: "output_tokens", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "cacheReadTokens", dbName: "cache_read_tokens", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "cacheCreationTokens", dbName: "cache_creation_tokens", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      // Cost in micro-USD (integer to avoid float drift); null if model unpriced.
      { field: "costMicroUsd", dbName: "cost_micro_usd", kind: "integer" },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "model_usage_session_idx", columns: ["sessionId"] },
      { name: "model_usage_user_idx", columns: ["userId"] },
      { name: "model_usage_instance_idx", columns: ["instanceSlug"] },
      { name: "model_usage_created_idx", columns: ["createdAt"] },
    ],
  },
  {
    exportName: "terminalSessions",
    sqlName: "terminal_session",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "name", dbName: "name", kind: "text", notNull: true },
      { field: "tmuxSessionName", dbName: "tmux_session_name", kind: "text", notNull: true, unique: true },
      { field: "projectPath", dbName: "project_path", kind: "text" },
      { field: "githubRepoId", dbName: "github_repo_id", kind: "text", references: { table: "githubRepositories", column: "id", onDelete: "set null" } },
      { field: "worktreeBranch", dbName: "worktree_branch", kind: "text" },
      { field: "worktreeType", dbName: "worktree_type", kind: "text", typeBrand: "WorktreeType" },
      { field: "projectId", dbName: "project_id", kind: "text", notNull: true, references: { table: "projects", column: "id", onDelete: "cascade" } },
      { field: "profileId", dbName: "profile_id", kind: "text", references: { table: "agentProfiles", column: "id", onDelete: "set null" } },
      { field: "terminalType", dbName: "terminal_type", kind: "text", typeBrand: "TerminalType", default: { kind: "value", value: "\"shell\"" } },
      { field: "agentProvider", dbName: "agent_provider", kind: "text", typeBrand: "AgentProviderType" },
      { field: "agentExitState", dbName: "agent_exit_state", kind: "text", typeBrand: "AgentExitState" },
      { field: "agentExitCode", dbName: "agent_exit_code", kind: "integer" },
      { field: "agentExitedAt", dbName: "agent_exited_at", kind: "timestampMs" },
      { field: "agentRestartCount", dbName: "agent_restart_count", kind: "integer", default: { kind: "value", value: "0" } },
      { field: "agentActivityStatus", dbName: "agent_activity_status", kind: "text" },
      // [remote-dev-1aa5] Server-arrival epoch ms of the most recent activity
      // status write. Plain integer (NOT timestampMs) so the value stays a raw
      // number comparable with `<=` in the monotonic WHERE guard that rejects
      // out-of-order writes. Nullable: older rows / non-agent sessions have none.
      { field: "agentActivityStatusAt", dbName: "agent_activity_status_at", kind: "integer" },
      { field: "typeMetadata", dbName: "type_metadata", kind: "text" },
      { field: "scopeKey", dbName: "scope_key", kind: "text" },
      { field: "parentSessionId", dbName: "parent_session_id", kind: "text" },
      { field: "orchestratorRole", dbName: "orchestrator_role", kind: "text", typeBrand: "\"parent\" | \"child\"" },
      { field: "status", dbName: "status", kind: "text", notNull: true, typeBrand: "SessionStatus", default: { kind: "value", value: "\"active\"" } },
      { field: "pinned", dbName: "pinned", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "tabOrder", dbName: "tab_order", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "lastActivityAt", dbName: "last_activity_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "terminal_session_user_status_idx", columns: ["userId","status"] },
      { name: "terminal_session_user_order_idx", columns: ["userId","tabOrder"] },
      { name: "terminal_session_project_idx", columns: ["projectId"] },
      { name: "terminal_session_type_idx", columns: ["userId","terminalType"] },
      { name: "terminal_session_scope_unique_idx", columns: ["userId","terminalType","scopeKey"], unique: true },
    ],
  },
  {
    exportName: "trashItems",
    sqlName: "trash_item",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "resourceType", dbName: "resource_type", kind: "text", notNull: true },
      { field: "resourceId", dbName: "resource_id", kind: "text", notNull: true },
      { field: "resourceName", dbName: "resource_name", kind: "text", notNull: true },
      { field: "trashedAt", dbName: "trashed_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "expiresAt", dbName: "expires_at", kind: "timestampMs", notNull: true, default: { kind: "raw", expr: "new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)" } },
    ],
    indexes: [
      { name: "trash_item_user_type_idx", columns: ["userId","resourceType"] },
      { name: "trash_item_expires_idx", columns: ["expiresAt"] },
      { name: "trash_item_resource_idx", columns: ["resourceType","resourceId"] },
    ],
  },
  {
    exportName: "worktreeTrashMetadata",
    sqlName: "worktree_trash_metadata",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "trashItemId", dbName: "trash_item_id", kind: "text", notNull: true, unique: true, references: { table: "trashItems", column: "id", onDelete: "cascade" } },
      { field: "githubRepoId", dbName: "github_repo_id", kind: "text", references: { table: "githubRepositories", column: "id", onDelete: "set null" } },
      { field: "repoName", dbName: "repo_name", kind: "text", notNull: true },
      { field: "repoLocalPath", dbName: "repo_local_path", kind: "text", notNull: true },
      { field: "worktreeBranch", dbName: "worktree_branch", kind: "text", notNull: true },
      { field: "worktreeOriginalPath", dbName: "worktree_original_path", kind: "text", notNull: true },
      { field: "worktreeTrashPath", dbName: "worktree_trash_path", kind: "text", notNull: true },
      { field: "originalProjectId", dbName: "original_project_id", kind: "text" },
      { field: "originalProjectName", dbName: "original_project_name", kind: "text" },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "worktree_trash_repo_idx", columns: ["githubRepoId"] },
    ],
  },
  {
    exportName: "githubRepositoryStats",
    sqlName: "github_repository_stats",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "repositoryId", dbName: "repository_id", kind: "text", notNull: true, unique: true, references: { table: "githubRepositories", column: "id", onDelete: "cascade" } },
      { field: "openPRCount", dbName: "open_pr_count", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "openIssueCount", dbName: "open_issue_count", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "ciStatus", dbName: "ci_status", kind: "text", typeBrand: "CIStatusState" },
      { field: "ciStatusDetails", dbName: "ci_status_details", kind: "text" },
      { field: "branchProtected", dbName: "branch_protected", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "branchProtectionDetails", dbName: "branch_protection_details", kind: "text" },
      { field: "recentCommits", dbName: "recent_commits", kind: "text" },
      { field: "cachedAt", dbName: "cached_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "expiresAt", dbName: "expires_at", kind: "timestampMs", notNull: true, default: { kind: "raw", expr: "new Date(Date.now() + 15 * 60 * 1000)" } },
    ],
    indexes: [
      { name: "github_repo_stats_repo_idx", columns: ["repositoryId"] },
      { name: "github_repo_stats_expires_idx", columns: ["expiresAt"] },
    ],
  },
  {
    exportName: "githubPullRequests",
    sqlName: "github_pull_request",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "repositoryId", dbName: "repository_id", kind: "text", notNull: true, references: { table: "githubRepositories", column: "id", onDelete: "cascade" } },
      { field: "prNumber", dbName: "pr_number", kind: "integer", notNull: true },
      { field: "title", dbName: "title", kind: "text", notNull: true },
      { field: "state", dbName: "state", kind: "text", notNull: true, typeBrand: "PRState" },
      { field: "branch", dbName: "branch", kind: "text", notNull: true },
      { field: "baseBranch", dbName: "base_branch", kind: "text", notNull: true },
      { field: "author", dbName: "author", kind: "text", notNull: true },
      { field: "authorAvatarUrl", dbName: "author_avatar_url", kind: "text" },
      { field: "url", dbName: "url", kind: "text", notNull: true },
      { field: "isDraft", dbName: "is_draft", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "additions", dbName: "additions", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "deletions", dbName: "deletions", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "reviewDecision", dbName: "review_decision", kind: "text", typeBrand: "\"APPROVED\" | \"CHANGES_REQUESTED\" | \"REVIEW_REQUIRED\"" },
      { field: "ciStatus", dbName: "ci_status", kind: "text", typeBrand: "CIStatusState" },
      { field: "isNew", dbName: "is_new", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true },
      { field: "cachedAt", dbName: "cached_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "github_pr_repo_idx", columns: ["repositoryId"] },
      { name: "github_pr_repo_number_idx", columns: ["repositoryId","prNumber"] },
      { name: "github_pr_state_idx", columns: ["repositoryId","state"] },
    ],
  },
  {
    exportName: "githubBranchProtection",
    sqlName: "github_branch_protection",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "repositoryId", dbName: "repository_id", kind: "text", notNull: true, references: { table: "githubRepositories", column: "id", onDelete: "cascade" } },
      { field: "branch", dbName: "branch", kind: "text", notNull: true },
      { field: "isProtected", dbName: "is_protected", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "requiresReview", dbName: "requires_review", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "requiredReviewers", dbName: "required_reviewers", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "requiresStatusChecks", dbName: "requires_status_checks", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "requiredChecks", dbName: "required_checks", kind: "text" },
      { field: "allowsForcePushes", dbName: "allows_force_pushes", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "allowsDeletions", dbName: "allows_deletions", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "cachedAt", dbName: "cached_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "github_branch_protection_repo_branch_idx", columns: ["repositoryId","branch"], unique: true },
    ],
  },
  {
    exportName: "githubStatsPreferences",
    sqlName: "github_stats_preferences",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "projectId", dbName: "project_id", kind: "text", references: { table: "projects", column: "id", onDelete: "cascade" } },
      { field: "showPRCount", dbName: "show_pr_count", kind: "boolean", notNull: true, default: { kind: "value", value: "true" } },
      { field: "showIssueCount", dbName: "show_issue_count", kind: "boolean", notNull: true, default: { kind: "value", value: "true" } },
      { field: "showCIStatus", dbName: "show_ci_status", kind: "boolean", notNull: true, default: { kind: "value", value: "true" } },
      { field: "showRecentCommits", dbName: "show_recent_commits", kind: "boolean", notNull: true, default: { kind: "value", value: "true" } },
      { field: "showBranchProtection", dbName: "show_branch_protection", kind: "boolean", notNull: true, default: { kind: "value", value: "true" } },
      { field: "refreshIntervalMinutes", dbName: "refresh_interval_minutes", kind: "integer", notNull: true, default: { kind: "value", value: "15" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "github_stats_prefs_user_idx", columns: ["userId"] },
      { name: "github_stats_prefs_project_idx", columns: ["projectId"] },
    ],
  },
  {
    exportName: "githubChangeNotifications",
    sqlName: "github_change_notification",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "repositoryId", dbName: "repository_id", kind: "text", notNull: true, references: { table: "githubRepositories", column: "id", onDelete: "cascade" } },
      { field: "newPRCount", dbName: "new_pr_count", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "newIssueCount", dbName: "new_issue_count", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "lastSeenAt", dbName: "last_seen_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "github_notifications_user_repo_idx", columns: ["userId","repositoryId"], unique: true },
      { name: "github_notifications_user_idx", columns: ["userId"] },
    ],
  },
  {
    exportName: "githubIssues",
    sqlName: "github_issue",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "repositoryId", dbName: "repository_id", kind: "text", notNull: true, references: { table: "githubRepositories", column: "id", onDelete: "cascade" } },
      { field: "issueNumber", dbName: "issue_number", kind: "integer", notNull: true },
      { field: "title", dbName: "title", kind: "text", notNull: true },
      { field: "state", dbName: "state", kind: "text", notNull: true, typeBrand: "\"open\" | \"closed\"" },
      { field: "body", dbName: "body", kind: "text" },
      { field: "htmlUrl", dbName: "html_url", kind: "text", notNull: true },
      { field: "author", dbName: "author", kind: "text" },
      { field: "labels", dbName: "labels", kind: "text", notNull: true, default: { kind: "value", value: "\"[]\"" } },
      { field: "assignees", dbName: "assignees", kind: "text", notNull: true, default: { kind: "value", value: "\"[]\"" } },
      { field: "milestone", dbName: "milestone", kind: "text" },
      { field: "comments", dbName: "comments", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "isPullRequest", dbName: "is_pull_request", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "isNew", dbName: "is_new", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true },
      { field: "cachedAt", dbName: "cached_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "github_issue_repo_idx", columns: ["repositoryId"] },
      { name: "github_issue_repo_number_idx", columns: ["repositoryId","issueNumber"], unique: true },
      { name: "github_issue_state_idx", columns: ["repositoryId","state"] },
      { name: "github_issue_cached_idx", columns: ["cachedAt"] },
    ],
  },
  {
    exportName: "sessionSchedules",
    sqlName: "session_schedule",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "sessionId", dbName: "session_id", kind: "text", notNull: true, references: { table: "terminalSessions", column: "id", onDelete: "cascade" } },
      { field: "name", dbName: "name", kind: "text", notNull: true },
      { field: "scheduleType", dbName: "schedule_type", kind: "text", notNull: true, typeBrand: "ScheduleType", default: { kind: "value", value: "\"one-time\"" } },
      { field: "cronExpression", dbName: "cron_expression", kind: "text" },
      { field: "scheduledAt", dbName: "scheduled_at", kind: "timestampMs" },
      { field: "timezone", dbName: "timezone", kind: "text", notNull: true, default: { kind: "value", value: "\"America/Los_Angeles\"" } },
      { field: "enabled", dbName: "enabled", kind: "boolean", notNull: true, default: { kind: "value", value: "true" } },
      { field: "status", dbName: "status", kind: "text", notNull: true, typeBrand: "ScheduleStatus", default: { kind: "value", value: "\"active\"" } },
      { field: "maxRetries", dbName: "max_retries", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "retryDelaySeconds", dbName: "retry_delay_seconds", kind: "integer", notNull: true, default: { kind: "value", value: "60" } },
      { field: "timeoutSeconds", dbName: "timeout_seconds", kind: "integer", notNull: true, default: { kind: "value", value: "300" } },
      { field: "lastRunAt", dbName: "last_run_at", kind: "timestampMs" },
      { field: "lastRunStatus", dbName: "last_run_status", kind: "text", typeBrand: "ExecutionStatus" },
      { field: "nextRunAt", dbName: "next_run_at", kind: "timestampMs" },
      { field: "consecutiveFailures", dbName: "consecutive_failures", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "session_schedule_user_idx", columns: ["userId"] },
      { name: "session_schedule_session_idx", columns: ["sessionId"] },
      { name: "session_schedule_next_run_idx", columns: ["enabled","nextRunAt"] },
    ],
  },
  {
    exportName: "scheduleCommands",
    sqlName: "schedule_command",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "scheduleId", dbName: "schedule_id", kind: "text", notNull: true, references: { table: "sessionSchedules", column: "id", onDelete: "cascade" } },
      { field: "command", dbName: "command", kind: "text", notNull: true },
      { field: "order", dbName: "order", kind: "integer", notNull: true },
      { field: "delayBeforeSeconds", dbName: "delay_before_seconds", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "continueOnError", dbName: "continue_on_error", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "schedule_command_schedule_idx", columns: ["scheduleId"] },
      { name: "schedule_command_order_idx", columns: ["scheduleId","order"] },
    ],
  },
  {
    exportName: "scheduleExecutions",
    sqlName: "schedule_execution",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "scheduleId", dbName: "schedule_id", kind: "text", notNull: true, references: { table: "sessionSchedules", column: "id", onDelete: "cascade" } },
      { field: "status", dbName: "status", kind: "text", notNull: true, typeBrand: "ExecutionStatus" },
      { field: "startedAt", dbName: "started_at", kind: "timestampMs", notNull: true },
      { field: "completedAt", dbName: "completed_at", kind: "timestampMs", notNull: true },
      { field: "durationMs", dbName: "duration_ms", kind: "integer", notNull: true },
      { field: "commandCount", dbName: "command_count", kind: "integer", notNull: true },
      { field: "successCount", dbName: "success_count", kind: "integer", notNull: true },
      { field: "failureCount", dbName: "failure_count", kind: "integer", notNull: true },
      { field: "errorMessage", dbName: "error_message", kind: "text" },
      { field: "output", dbName: "output", kind: "text" },
    ],
    indexes: [
      { name: "schedule_execution_schedule_idx", columns: ["scheduleId"] },
      { name: "schedule_execution_started_idx", columns: ["scheduleId","startedAt"] },
    ],
  },
  {
    exportName: "commandExecutions",
    sqlName: "command_execution",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "executionId", dbName: "execution_id", kind: "text", notNull: true, references: { table: "scheduleExecutions", column: "id", onDelete: "cascade" } },
      { field: "commandId", dbName: "command_id", kind: "text", notNull: true, references: { table: "scheduleCommands", column: "id", onDelete: "cascade" } },
      { field: "command", dbName: "command", kind: "text", notNull: true },
      { field: "status", dbName: "status", kind: "text", notNull: true, typeBrand: "ExecutionStatus" },
      { field: "exitCode", dbName: "exit_code", kind: "integer" },
      { field: "startedAt", dbName: "started_at", kind: "timestampMs", notNull: true },
      { field: "completedAt", dbName: "completed_at", kind: "timestampMs", notNull: true },
      { field: "durationMs", dbName: "duration_ms", kind: "integer", notNull: true },
      { field: "output", dbName: "output", kind: "text" },
      { field: "errorMessage", dbName: "error_message", kind: "text" },
    ],
    indexes: [
      { name: "command_execution_execution_idx", columns: ["executionId"] },
      { name: "command_execution_command_idx", columns: ["commandId"] },
    ],
  },
  {
    exportName: "setupConfig",
    sqlName: "setup_config",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "workingDirectory", dbName: "working_directory", kind: "text", notNull: true },
      { field: "nextPort", dbName: "next_port", kind: "integer", notNull: true, default: { kind: "value", value: "3000" } },
      { field: "terminalPort", dbName: "terminal_port", kind: "integer", notNull: true, default: { kind: "value", value: "3001" } },
      { field: "wslDistribution", dbName: "wsl_distribution", kind: "text" },
      { field: "autoStart", dbName: "auto_start", kind: "boolean", notNull: true, default: { kind: "value", value: "true" } },
      { field: "checkForUpdates", dbName: "check_for_updates", kind: "boolean", notNull: true, default: { kind: "value", value: "true" } },
      { field: "isComplete", dbName: "is_complete", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "completedAt", dbName: "completed_at", kind: "timestampMs" },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
  },
  {
    exportName: "agentProfiles",
    sqlName: "agent_profile",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "name", dbName: "name", kind: "text", notNull: true },
      { field: "description", dbName: "description", kind: "text" },
      { field: "provider", dbName: "provider", kind: "text", notNull: true, typeBrand: "AgentProvider", default: { kind: "value", value: "\"all\"" } },
      { field: "configDir", dbName: "config_dir", kind: "text", notNull: true },
      { field: "isDefault", dbName: "is_default", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "agent_profile_user_idx", columns: ["userId"] },
      { name: "agent_profile_default_idx", columns: ["userId","isDefault"] },
    ],
  },
  {
    exportName: "agentConfigs",
    sqlName: "agent_config",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "projectId", dbName: "project_id", kind: "text", references: { table: "projects", column: "id", onDelete: "cascade" } },
      { field: "provider", dbName: "provider", kind: "text", notNull: true, typeBrand: "AgentProvider" },
      { field: "configType", dbName: "config_type", kind: "text", notNull: true, typeBrand: "AgentConfigType" },
      { field: "content", dbName: "content", kind: "text", notNull: true, default: { kind: "value", value: "\"\"" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "agent_config_user_idx", columns: ["userId"] },
      { name: "agent_config_project_idx", columns: ["projectId"] },
      { name: "agent_config_unique_idx", columns: ["userId","projectId","provider","configType"], unique: true },
    ],
  },
  {
    exportName: "mcpServers",
    sqlName: "mcp_server",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "projectId", dbName: "project_id", kind: "text", references: { table: "projects", column: "id", onDelete: "cascade" } },
      { field: "name", dbName: "name", kind: "text", notNull: true },
      { field: "transport", dbName: "transport", kind: "text", notNull: true, typeBrand: "MCPTransport", default: { kind: "value", value: "\"stdio\"" } },
      { field: "command", dbName: "command", kind: "text", notNull: true },
      { field: "args", dbName: "args", kind: "text", notNull: true, default: { kind: "value", value: "\"[]\"" } },
      { field: "env", dbName: "env", kind: "text", notNull: true, default: { kind: "value", value: "\"{}\"" } },
      { field: "enabled", dbName: "enabled", kind: "boolean", notNull: true, default: { kind: "value", value: "true" } },
      { field: "autoStart", dbName: "auto_start", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "lastHealthCheck", dbName: "last_health_check", kind: "timestampMs" },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "mcp_server_user_idx", columns: ["userId"] },
      { name: "mcp_server_project_idx", columns: ["projectId"] },
      { name: "mcp_server_enabled_idx", columns: ["userId","enabled"] },
    ],
  },
  {
    exportName: "profileGitIdentities",
    sqlName: "profile_git_identity",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "profileId", dbName: "profile_id", kind: "text", notNull: true, unique: true, references: { table: "agentProfiles", column: "id", onDelete: "cascade" } },
      { field: "userName", dbName: "user_name", kind: "text", notNull: true },
      { field: "userEmail", dbName: "user_email", kind: "text", notNull: true },
      { field: "sshKeyPath", dbName: "ssh_key_path", kind: "text" },
      { field: "gpgKeyId", dbName: "gpg_key_id", kind: "text" },
      { field: "githubUsername", dbName: "github_username", kind: "text" },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "profile_git_identity_profile_idx", columns: ["profileId"] },
    ],
  },
  {
    exportName: "profileSecretsConfig",
    sqlName: "profile_secrets_config",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "profileId", dbName: "profile_id", kind: "text", notNull: true, unique: true, references: { table: "agentProfiles", column: "id", onDelete: "cascade" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "provider", dbName: "provider", kind: "text", notNull: true },
      { field: "providerConfig", dbName: "provider_config", kind: "text", notNull: true },
      { field: "enabled", dbName: "enabled", kind: "boolean", notNull: true, default: { kind: "value", value: "true" } },
      { field: "lastFetchedAt", dbName: "last_fetched_at", kind: "timestampMs" },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "profile_secrets_config_profile_idx", columns: ["profileId"] },
      { name: "profile_secrets_config_user_idx", columns: ["userId"] },
    ],
  },
  {
    exportName: "mcpDiscoveredTools",
    sqlName: "mcp_discovered_tool",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "serverId", dbName: "server_id", kind: "text", notNull: true, references: { table: "mcpServers", column: "id", onDelete: "cascade" } },
      { field: "name", dbName: "name", kind: "text", notNull: true },
      { field: "description", dbName: "description", kind: "text" },
      { field: "inputSchema", dbName: "input_schema", kind: "text" },
      { field: "discoveredAt", dbName: "discovered_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "mcp_discovered_tool_server_idx", columns: ["serverId"] },
      { name: "mcp_discovered_tool_unique_idx", columns: ["serverId","name"], unique: true },
    ],
  },
  {
    exportName: "mcpDiscoveredResources",
    sqlName: "mcp_discovered_resource",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "serverId", dbName: "server_id", kind: "text", notNull: true, references: { table: "mcpServers", column: "id", onDelete: "cascade" } },
      { field: "uri", dbName: "uri", kind: "text", notNull: true },
      { field: "name", dbName: "name", kind: "text" },
      { field: "description", dbName: "description", kind: "text" },
      { field: "mimeType", dbName: "mime_type", kind: "text" },
      { field: "discoveredAt", dbName: "discovered_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "mcp_discovered_resource_server_idx", columns: ["serverId"] },
      { name: "mcp_discovered_resource_unique_idx", columns: ["serverId","uri"], unique: true },
    ],
  },
  {
    exportName: "agentActivityEvents",
    sqlName: "agent_activity_event",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "sessionId", dbName: "session_id", kind: "text", references: { table: "terminalSessions", column: "id", onDelete: "set null" } },
      { field: "agentProvider", dbName: "agent_provider", kind: "text", typeBrand: "AgentProviderType" },
      { field: "eventType", dbName: "event_type", kind: "text", notNull: true },
      { field: "eventData", dbName: "event_data", kind: "text" },
      { field: "duration", dbName: "duration", kind: "integer" },
      { field: "success", dbName: "success", kind: "boolean" },
      { field: "errorMessage", dbName: "error_message", kind: "text" },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "agent_activity_user_idx", columns: ["userId"] },
      { name: "agent_activity_session_idx", columns: ["sessionId"] },
      { name: "agent_activity_provider_idx", columns: ["userId","agentProvider"] },
      { name: "agent_activity_event_type_idx", columns: ["userId","eventType"] },
      { name: "agent_activity_created_idx", columns: ["userId","createdAt"] },
    ],
  },
  {
    exportName: "agentDailyStats",
    sqlName: "agent_daily_stats",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "date", dbName: "date", kind: "text", notNull: true },
      { field: "agentProvider", dbName: "agent_provider", kind: "text", typeBrand: "AgentProviderType" },
      { field: "sessionCount", dbName: "session_count", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "commandCount", dbName: "command_count", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "errorCount", dbName: "error_count", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "totalDuration", dbName: "total_duration", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "toolCallCount", dbName: "tool_call_count", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "agent_daily_stats_unique_idx", columns: ["userId","date","agentProvider"], unique: true },
      { name: "agent_daily_stats_user_date_idx", columns: ["userId","date"] },
    ],
  },
  {
    exportName: "sessionMemory",
    sqlName: "session_memory",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "projectId", dbName: "project_id", kind: "text", references: { table: "projects", column: "id", onDelete: "set null" } },
      { field: "type", dbName: "type", kind: "text", notNull: true, typeBrand: "\"note\" | \"artifact\" | \"summary\"" },
      { field: "title", dbName: "title", kind: "text", notNull: true },
      { field: "content", dbName: "content", kind: "text", notNull: true },
      { field: "tags", dbName: "tags", kind: "text", notNull: true, default: { kind: "value", value: "\"[]\"" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "session_memory_user_idx", columns: ["userId"] },
      { name: "session_memory_project_idx", columns: ["projectId"] },
      { name: "session_memory_type_idx", columns: ["userId","type"] },
    ],
  },
  {
    exportName: "colorSchemes",
    sqlName: "color_scheme",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, typeBrand: "ColorSchemeId" },
      { field: "name", dbName: "name", kind: "text", notNull: true },
      { field: "description", dbName: "description", kind: "text" },
      { field: "category", dbName: "category", kind: "text", notNull: true, typeBrand: "ColorSchemeCategory" },
      { field: "colorDefinitions", dbName: "color_definitions", kind: "text", notNull: true },
      { field: "terminalPalette", dbName: "terminal_palette", kind: "text" },
      { field: "isBuiltIn", dbName: "is_built_in", kind: "boolean", notNull: true, default: { kind: "value", value: "true" } },
      { field: "sortOrder", dbName: "sort_order", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "color_scheme_category_idx", columns: ["category"] },
      { name: "color_scheme_sort_idx", columns: ["sortOrder"] },
    ],
  },
  {
    exportName: "appearanceSettings",
    sqlName: "appearance_settings",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, unique: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "appearanceMode", dbName: "appearance_mode", kind: "text", notNull: true, typeBrand: "AppearanceMode", default: { kind: "value", value: "\"system\"" } },
      { field: "lightColorScheme", dbName: "light_color_scheme", kind: "text", notNull: true, typeBrand: "ColorSchemeId", default: { kind: "value", value: "\"ocean\"" } },
      { field: "darkColorScheme", dbName: "dark_color_scheme", kind: "text", notNull: true, typeBrand: "ColorSchemeId", default: { kind: "value", value: "\"midnight\"" } },
      { field: "terminalOpacity", dbName: "terminal_opacity", kind: "integer", notNull: true, default: { kind: "value", value: "100" } },
      { field: "terminalBlur", dbName: "terminal_blur", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "terminalCursorStyle", dbName: "terminal_cursor_style", kind: "text", notNull: true, typeBrand: "\"block\" | \"underline\" | \"bar\"", default: { kind: "value", value: "\"block\"" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "appearance_settings_user_idx", columns: ["userId"] },
    ],
  },
  {
    exportName: "agentProfileJsonConfigs",
    sqlName: "agent_profile_json_config",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "profileId", dbName: "profile_id", kind: "text", notNull: true, references: { table: "agentProfiles", column: "id", onDelete: "cascade" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "agentType", dbName: "agent_type", kind: "text", notNull: true, typeBrand: "Exclude<AgentProvider, \"all\">" },
      { field: "configJson", dbName: "config_json", kind: "text", notNull: true, default: { kind: "value", value: "\"{}\"" } },
      { field: "isValid", dbName: "is_valid", kind: "boolean", notNull: true, default: { kind: "value", value: "true" } },
      { field: "validationErrors", dbName: "validation_errors", kind: "text" },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "agent_profile_json_config_profile_idx", columns: ["profileId"] },
      { name: "agent_profile_json_config_user_idx", columns: ["userId"] },
      { name: "agent_profile_json_config_unique_idx", columns: ["profileId","agentType"], unique: true },
    ],
  },
  {
    exportName: "profileAppearanceSettings",
    sqlName: "profile_appearance_settings",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "profileId", dbName: "profile_id", kind: "text", notNull: true, unique: true, references: { table: "agentProfiles", column: "id", onDelete: "cascade" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "appearanceMode", dbName: "appearance_mode", kind: "text", notNull: true, typeBrand: "AppearanceMode", default: { kind: "value", value: "\"system\"" } },
      { field: "lightColorScheme", dbName: "light_color_scheme", kind: "text", notNull: true, typeBrand: "ColorSchemeId", default: { kind: "value", value: "\"ocean\"" } },
      { field: "darkColorScheme", dbName: "dark_color_scheme", kind: "text", notNull: true, typeBrand: "ColorSchemeId", default: { kind: "value", value: "\"midnight\"" } },
      { field: "terminalOpacity", dbName: "terminal_opacity", kind: "integer", notNull: true, default: { kind: "value", value: "100" } },
      { field: "terminalBlur", dbName: "terminal_blur", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "terminalCursorStyle", dbName: "terminal_cursor_style", kind: "text", notNull: true, typeBrand: "\"block\" | \"underline\" | \"bar\"", default: { kind: "value", value: "\"block\"" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "profile_appearance_profile_idx", columns: ["profileId"] },
      { name: "profile_appearance_user_idx", columns: ["userId"] },
    ],
  },
  {
    exportName: "projectTasks",
    sqlName: "project_task",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "projectId", dbName: "project_id", kind: "text", notNull: true, references: { table: "projects", column: "id", onDelete: "cascade" } },
      { field: "sessionId", dbName: "session_id", kind: "text", references: { table: "terminalSessions", column: "id", onDelete: "set null" } },
      { field: "title", dbName: "title", kind: "text", notNull: true },
      { field: "description", dbName: "description", kind: "text" },
      { field: "status", dbName: "status", kind: "text", notNull: true, typeBrand: "TaskStatus", default: { kind: "value", value: "\"open\"" } },
      { field: "priority", dbName: "priority", kind: "text", notNull: true, typeBrand: "TaskPriority", default: { kind: "value", value: "\"medium\"" } },
      { field: "source", dbName: "source", kind: "text", notNull: true, typeBrand: "TaskSource", default: { kind: "value", value: "\"manual\"" } },
      { field: "labels", dbName: "labels", kind: "text", notNull: true, default: { kind: "value", value: "\"[]\"" } },
      { field: "subtasks", dbName: "subtasks", kind: "text", notNull: true, default: { kind: "value", value: "\"[]\"" } },
      { field: "metadata", dbName: "metadata", kind: "text", notNull: true, default: { kind: "value", value: "\"{}\"" } },
      { field: "instructions", dbName: "instructions", kind: "text" },
      { field: "agentTaskKey", dbName: "agent_task_key", kind: "text" },
      { field: "owner", dbName: "owner", kind: "text" },
      { field: "dueDate", dbName: "due_date", kind: "timestampMs" },
      { field: "githubIssueUrl", dbName: "github_issue_url", kind: "text" },
      { field: "sortOrder", dbName: "sort_order", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "project_task_user_idx", columns: ["userId"] },
      { name: "project_task_project_idx", columns: ["projectId"] },
      { name: "project_task_user_project_idx", columns: ["userId","projectId"] },
      { name: "project_task_session_idx", columns: ["sessionId"] },
      { name: "project_task_agent_key_idx", columns: ["sessionId","agentTaskKey"] },
    ],
  },
  {
    exportName: "taskDependencies",
    sqlName: "task_dependency",
    columns: [
      { field: "blockerId", dbName: "blocker_id", kind: "text", notNull: true, references: { table: "projectTasks", column: "id", onDelete: "cascade" } },
      { field: "blockedId", dbName: "blocked_id", kind: "text", notNull: true, references: { table: "projectTasks", column: "id", onDelete: "cascade" } },
    ],
    primaryKey: ["blockerId","blockedId"],
    indexes: [
      { name: "task_dep_blocker_idx", columns: ["blockerId"] },
      { name: "task_dep_blocked_idx", columns: ["blockedId"] },
    ],
  },
  {
    exportName: "notificationEvents",
    sqlName: "notification_event",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "sessionId", dbName: "session_id", kind: "text", references: { table: "terminalSessions", column: "id", onDelete: "set null" } },
      { field: "sessionName", dbName: "session_name", kind: "text" },
      { field: "type", dbName: "type", kind: "text", notNull: true, typeBrand: "NotificationType" },
      // [y5ch.1] Signal class derived from `type` (actionable | passive | error).
      { field: "severity", dbName: "severity", kind: "text", notNull: true, typeBrand: "NotificationSeverity", default: { kind: "value", value: "\"passive\"" } },
      { field: "title", dbName: "title", kind: "text", notNull: true },
      { field: "body", dbName: "body", kind: "text" },
      // [y5ch.5] Coalescing: rows sharing this key collapse into one open notification.
      { field: "coalesceKey", dbName: "coalesce_key", kind: "text" },
      // [y5ch.5] Number of collapsed events (1 normally).
      { field: "count", dbName: "count", kind: "integer", notNull: true, default: { kind: "value", value: "1" } },
      // [y5ch.8] Structured client-routing payload (deep-link, CTA, duration, result).
      { field: "meta", dbName: "meta", kind: "json", typeBrand: "NotificationMeta | null" },
      { field: "readAt", dbName: "read_at", kind: "timestampMs" },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      // [y5ch.1] Last time the (possibly coalesced) row was touched.
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "notification_event_user_created_idx", columns: ["userId","createdAt"] },
      { name: "notification_event_user_read_idx", columns: ["userId","readAt"] },
      // [y5ch.5] Lookup for coalescing an open (unread) row in a group.
      { name: "notification_event_coalesce_idx", columns: ["userId","sessionId","coalesceKey","readAt"] },
    ],
  },
  {
    exportName: "pushTokens",
    sqlName: "push_token",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "fcmToken", dbName: "fcm_token", kind: "text", notNull: true },
      { field: "platform", dbName: "platform", kind: "text", notNull: true, typeBrand: "\"android\" | \"ios\"" },
      { field: "deviceId", dbName: "device_id", kind: "text" },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "push_token_user_idx", columns: ["userId"] },
      { name: "push_token_fcm_token_idx", columns: ["fcmToken"], unique: true },
    ],
  },
  {
    // [y5ch.6] Per-user notification preferences: per-type push opt-out,
    // per-session mute, quiet hours, and the minimum severity allowed to push.
    exportName: "notificationPreferences",
    sqlName: "notification_preferences",
    columns: [
      { field: "userId", dbName: "user_id", kind: "text", primaryKey: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      // Per-type push opt-out. JSON: { [NotificationType]: boolean }. Missing = on.
      { field: "pushByType", dbName: "push_by_type", kind: "json", typeBrand: "Record<string, boolean>", notNull: true, default: { kind: "value", value: "{}" } },
      // Per-session mute. JSON: array of sessionId strings.
      { field: "mutedSessionIds", dbName: "muted_session_ids", kind: "json", typeBrand: "string[]", notNull: true, default: { kind: "value", value: "[]" } },
      // Quiet hours (local tz, 0-23). null = disabled.
      { field: "quietHoursStart", dbName: "quiet_hours_start", kind: "integer" },
      { field: "quietHoursEnd", dbName: "quiet_hours_end", kind: "integer" },
      // Minimum severity allowed to push. Default actionable (drops passive).
      { field: "minPushSeverity", dbName: "min_push_severity", kind: "text", notNull: true, typeBrand: "NotificationSeverity", default: { kind: "value", value: "\"actionable\"" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
  },
  {
    exportName: "agentPeerMessages",
    sqlName: "agent_peer_message",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "projectId", dbName: "project_id", kind: "text", notNull: true },
      { field: "fromSessionId", dbName: "from_session_id", kind: "text", references: { table: "terminalSessions", column: "id", onDelete: "set null" } },
      { field: "fromSessionName", dbName: "from_session_name", kind: "text", notNull: true },
      { field: "toSessionId", dbName: "to_session_id", kind: "text", references: { table: "terminalSessions", column: "id", onDelete: "set null" } },
      { field: "body", dbName: "body", kind: "text", notNull: true },
      { field: "isUserMessage", dbName: "is_user_message", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "channelId", dbName: "channel_id", kind: "text", references: { table: "channels", column: "id", onDelete: "set null" } },
      { field: "parentMessageId", dbName: "parent_message_id", kind: "text" },
      { field: "replyCount", dbName: "reply_count", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "peer_message_project_created_idx", columns: ["projectId","createdAt"] },
      { name: "peer_message_to_session_idx", columns: ["toSessionId"] },
      { name: "peer_message_channel_created_idx", columns: ["channelId","createdAt"] },
      { name: "peer_message_parent_idx", columns: ["parentMessageId"] },
    ],
  },
  {
    exportName: "channelGroups",
    sqlName: "channel_group",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "projectId", dbName: "project_id", kind: "text", notNull: true, references: { table: "projects", column: "id", onDelete: "cascade" } },
      { field: "name", dbName: "name", kind: "text", notNull: true },
      { field: "position", dbName: "position", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "channel_group_project_idx", columns: ["projectId"] },
      { name: "channel_group_project_name_idx", columns: ["projectId","name"], unique: true },
    ],
  },
  {
    exportName: "channels",
    sqlName: "channel",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "projectId", dbName: "project_id", kind: "text", notNull: true, references: { table: "projects", column: "id", onDelete: "cascade" } },
      { field: "groupId", dbName: "group_id", kind: "text", notNull: true, references: { table: "channelGroups", column: "id", onDelete: "cascade" } },
      { field: "name", dbName: "name", kind: "text", notNull: true },
      { field: "displayName", dbName: "display_name", kind: "text", notNull: true },
      { field: "type", dbName: "type", kind: "text", notNull: true, typeBrand: "ChannelType", default: { kind: "value", value: "\"public\"" } },
      { field: "topic", dbName: "topic", kind: "text" },
      { field: "isDefault", dbName: "is_default", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "createdBySessionId", dbName: "created_by_session_id", kind: "text" },
      { field: "lastMessageAt", dbName: "last_message_at", kind: "timestampMs" },
      { field: "messageCount", dbName: "message_count", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "archivedAt", dbName: "archived_at", kind: "timestampMs" },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "channel_project_idx", columns: ["projectId"] },
      { name: "channel_group_idx", columns: ["groupId"] },
      { name: "channel_project_name_idx", columns: ["projectId","name"], unique: true },
    ],
  },
  {
    exportName: "channelReadState",
    sqlName: "channel_read_state",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "channelId", dbName: "channel_id", kind: "text", notNull: true, references: { table: "channels", column: "id", onDelete: "cascade" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "lastReadMessageId", dbName: "last_read_message_id", kind: "text" },
      { field: "lastReadAt", dbName: "last_read_at", kind: "timestampMs" },
    ],
    indexes: [
      { name: "channel_read_state_unique_idx", columns: ["channelId","userId"], unique: true },
      { name: "channel_read_state_user_idx", columns: ["userId"] },
    ],
  },
  {
    exportName: "systemUpdateCache",
    sqlName: "system_update_cache",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "value", value: "\"singleton\"" } },
      { field: "lastChecked", dbName: "last_checked", kind: "timestampMs" },
      { field: "cachedReleaseJson", dbName: "cached_release_json", kind: "text" },
      { field: "deploymentStateJson", dbName: "deployment_state_json", kind: "text" },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
  },
  {
    exportName: "litellmConfig",
    sqlName: "litellm_config",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, unique: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "enabled", dbName: "enabled", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "autoStart", dbName: "auto_start", kind: "boolean", notNull: true, default: { kind: "value", value: "true" } },
      { field: "port", dbName: "port", kind: "integer", notNull: true, default: { kind: "value", value: "4000" } },
      { field: "masterKey", dbName: "master_key", kind: "text" },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
  },
  {
    exportName: "litellmModels",
    sqlName: "litellm_model",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "modelName", dbName: "model_name", kind: "text", notNull: true },
      { field: "provider", dbName: "provider", kind: "text", notNull: true },
      { field: "litellmModel", dbName: "litellm_model", kind: "text", notNull: true },
      { field: "apiBase", dbName: "api_base", kind: "text" },
      { field: "encryptedApiKey", dbName: "encrypted_api_key", kind: "text" },
      { field: "keyPrefix", dbName: "key_prefix", kind: "text" },
      { field: "extraHeaders", dbName: "extra_headers", kind: "text" },
      { field: "priority", dbName: "priority", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "paused", dbName: "paused", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "isDefault", dbName: "is_default", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "litellm_model_user_idx", columns: ["userId"] },
    ],
  },
  {
    exportName: "projectGroups",
    sqlName: "project_group",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "parentGroupId", dbName: "parent_group_id", kind: "text", references: { table: "projectGroups", column: "id", onDelete: "set null", selfRef: true } },
      { field: "name", dbName: "name", kind: "text", notNull: true },
      { field: "collapsed", dbName: "collapsed", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "sortOrder", dbName: "sort_order", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampS", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampS", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "project_group_user_idx", columns: ["userId"] },
      { name: "project_group_parent_idx", columns: ["parentGroupId"] },
    ],
  },
  {
    exportName: "projects",
    sqlName: "project",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "groupId", dbName: "group_id", kind: "text", references: { table: "projectGroups", column: "id", onDelete: "set null" } },
      { field: "name", dbName: "name", kind: "text", notNull: true },
      { field: "collapsed", dbName: "collapsed", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "sortOrder", dbName: "sort_order", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "isAutoCreated", dbName: "is_auto_created", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampS", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampS", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "project_user_idx", columns: ["userId"] },
      { name: "project_group_idx", columns: ["groupId"] },
    ],
  },
  {
    // Claude-specific identity + account kind, kept off the provider-agnostic
    // agent_profile. 1:1 with a profile. [remote-dev-3b3l]
    exportName: "claudeAccounts",
    sqlName: "claude_account",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "profileId", dbName: "profile_id", kind: "text", notNull: true, unique: true, references: { table: "agentProfiles", column: "id", onDelete: "cascade" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "accountKind", dbName: "account_kind", kind: "text", notNull: true, typeBrand: "ClaudeAccountKind", default: { kind: "value", value: "\"subscription\"" } },
      // "file" | "keychain"; null = unknown (P2 fills it).
      { field: "credentialMode", dbName: "credential_mode", kind: "text" },
      // Display fields sourced from ~/.claude.json oauthAccount.
      { field: "emailAddress", dbName: "email_address", kind: "text" },
      { field: "organizationName", dbName: "organization_name", kind: "text" },
      { field: "rateLimitTier", dbName: "rate_limit_tier", kind: "text" },
      // First 8 chars only; the full key stays in profile_secrets_config.
      { field: "apiKeyPrefix", dbName: "api_key_prefix", kind: "text" },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "claude_account_profile_idx", columns: ["profileId"] },
      { name: "claude_account_user_idx", columns: ["userId"] },
    ],
  },
  {
    // Authoritative per-profile Claude usage-limit store. [remote-dev-3b3l]
    exportName: "claudeUsageLimitStates",
    sqlName: "claude_usage_limit_state",
    columns: [
      { field: "profileId", dbName: "profile_id", kind: "text", primaryKey: true, references: { table: "agentProfiles", column: "id", onDelete: "cascade" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "limitStatus", dbName: "limit_status", kind: "text", notNull: true, typeBrand: "ClaudeLimitStatus", default: { kind: "value", value: "\"unknown\"" } },
      // 0-100, null if unknown.
      { field: "window5hPct", dbName: "window_5h_pct", kind: "integer" },
      { field: "window7dPct", dbName: "window_7d_pct", kind: "integer" },
      { field: "resetAt5h", dbName: "reset_at_5h", kind: "timestampMs" },
      { field: "resetAt7d", dbName: "reset_at_7d", kind: "timestampMs" },
      // min(resetAt5h, resetAt7d): soonest the account is available again.
      { field: "effectiveResetAt", dbName: "effective_reset_at", kind: "timestampMs" },
      { field: "detectionSource", dbName: "detection_source", kind: "text", typeBrand: "UsageDetectionSource" },
      { field: "lastCheckedAt", dbName: "last_checked_at", kind: "timestampMs" },
      { field: "lastPolledAt", dbName: "last_polled_at", kind: "timestampMs" },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "claude_usage_limit_user_status_idx", columns: ["userId","limitStatus"] },
      { name: "claude_usage_limit_user_idx", columns: ["userId"] },
    ],
  },
  {
    // A named, ordered fallback pool of Claude profiles to rotate through when
    // the primary is limited. [remote-dev-3b3l]
    exportName: "claudeProfilePools",
    sqlName: "claude_profile_pool",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "name", dbName: "name", kind: "text", notNull: true },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "claude_profile_pool_user_idx", columns: ["userId"] },
    ],
  },
  {
    // Membership of a profile in a pool, with rotation priority
    // (lower = higher priority / earlier in rotation). [remote-dev-3b3l]
    exportName: "claudeProfilePoolMembers",
    sqlName: "claude_profile_pool_member",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "poolId", dbName: "pool_id", kind: "text", notNull: true, references: { table: "claudeProfilePools", column: "id", onDelete: "cascade" } },
      { field: "profileId", dbName: "profile_id", kind: "text", notNull: true, references: { table: "agentProfiles", column: "id", onDelete: "cascade" } },
      { field: "priority", dbName: "priority", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "claude_pool_member_pool_profile_unique", columns: ["poolId","profileId"], unique: true },
      { name: "claude_pool_member_pool_priority_idx", columns: ["poolId","priority"] },
      { name: "claude_pool_member_profile_idx", columns: ["profileId"] },
    ],
  },
  {
    exportName: "nodePreferences",
    sqlName: "node_preferences",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true },
      { field: "ownerId", dbName: "owner_id", kind: "text", notNull: true },
      { field: "ownerType", dbName: "owner_type", kind: "text", notNull: true, enumValues: ["group","project"] },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "defaultWorkingDirectory", dbName: "default_working_directory", kind: "text" },
      { field: "defaultShell", dbName: "default_shell", kind: "text" },
      { field: "startupCommand", dbName: "startup_command", kind: "text" },
      { field: "theme", dbName: "theme", kind: "text" },
      { field: "fontSize", dbName: "font_size", kind: "integer" },
      { field: "fontFamily", dbName: "font_family", kind: "text" },
      { field: "githubRepoId", dbName: "github_repo_id", kind: "text" },
      { field: "localRepoPath", dbName: "local_repo_path", kind: "text" },
      { field: "defaultAgentProvider", dbName: "default_agent_provider", kind: "text" },
      { field: "agentProviderSettings", dbName: "agent_provider_settings", kind: "json" },
      { field: "environmentVars", dbName: "environment_vars", kind: "json" },
      { field: "pinnedFiles", dbName: "pinned_files", kind: "json" },
      { field: "gitIdentityName", dbName: "git_identity_name", kind: "text" },
      { field: "gitIdentityEmail", dbName: "git_identity_email", kind: "text" },
      { field: "isSensitive", dbName: "is_sensitive", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      // Group/project-inherited Claude fallback pool + per-node auto-relaunch
      // override (null = inherit). Resolved via the existing preference chain
      // (resolvePreferences reads the whole row — no resolver change). [remote-dev-3b3l]
      { field: "claudeProfilePoolId", dbName: "claude_profile_pool_id", kind: "text" },
      { field: "claudeAutoRelaunchMode", dbName: "claude_auto_relaunch_mode", kind: "text", typeBrand: "ClaudeAutoRelaunchMode" },
      { field: "createdAt", dbName: "created_at", kind: "timestampS", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampS", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "node_pref_owner_idx", columns: ["ownerId","ownerType"] },
      { name: "node_pref_owner_user_idx", columns: ["ownerId","ownerType","userId"], unique: true },
    ],
  },
  {
    exportName: "projectSecretsConfig",
    sqlName: "project_secrets_config",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "projectId", dbName: "project_id", kind: "text", notNull: true, references: { table: "projects", column: "id", onDelete: "cascade" } },
      { field: "provider", dbName: "provider", kind: "text", notNull: true },
      { field: "providerConfig", dbName: "provider_config", kind: "json", notNull: true },
      { field: "enabled", dbName: "enabled", kind: "boolean", notNull: true, default: { kind: "value", value: "true" } },
      { field: "lastFetchedAt", dbName: "last_fetched_at", kind: "timestampS" },
      { field: "createdAt", dbName: "created_at", kind: "timestampS", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampS", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "project_secrets_project_user_idx", columns: ["projectId","userId"], unique: true },
    ],
  },
  {
    exportName: "projectGitHubAccountLinks",
    sqlName: "project_github_account_link",
    columns: [
      { field: "projectId", dbName: "project_id", kind: "text", primaryKey: true, references: { table: "projects", column: "id", onDelete: "cascade" } },
      { field: "providerAccountId", dbName: "provider_account_id", kind: "text", notNull: true },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "project_gh_link_account_idx", columns: ["providerAccountId"] },
    ],
  },
  {
    exportName: "projectProfileLinks",
    sqlName: "project_profile_link",
    columns: [
      { field: "projectId", dbName: "project_id", kind: "text", primaryKey: true, references: { table: "projects", column: "id", onDelete: "cascade" } },
      { field: "profileId", dbName: "profile_id", kind: "text", notNull: true, references: { table: "agentProfiles", column: "id", onDelete: "cascade" } },
      // Fallback pool for auto-rotation (primary profileId above stays primary;
      // set null on pool delete). [remote-dev-3b3l]
      { field: "poolId", dbName: "pool_id", kind: "text", references: { table: "claudeProfilePools", column: "id", onDelete: "set null" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "project_profile_link_profile_idx", columns: ["profileId"] },
    ],
  },
  {
    exportName: "projectRepositories",
    sqlName: "project_repository",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "projectId", dbName: "project_id", kind: "text", notNull: true, references: { table: "projects", column: "id", onDelete: "cascade" } },
      { field: "repositoryId", dbName: "repository_id", kind: "text", notNull: true, references: { table: "githubRepositories", column: "id", onDelete: "cascade" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "project_repo_project_user_idx", columns: ["projectId","userId"], unique: true },
      { name: "project_repo_user_idx", columns: ["userId"] },
    ],
  },
  {
    exportName: "sshConnections",
    sqlName: "ssh_connection",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "projectId", dbName: "project_id", kind: "text", references: { table: "projects", column: "id", onDelete: "set null" } },
      { field: "name", dbName: "name", kind: "text", notNull: true },
      { field: "host", dbName: "host", kind: "text", notNull: true },
      { field: "port", dbName: "port", kind: "integer", notNull: true, default: { kind: "value", value: "22" } },
      { field: "username", dbName: "username", kind: "text", notNull: true },
      { field: "authType", dbName: "auth_type", kind: "text", notNull: true, enumValues: ["key","agent","password","system"] },
      { field: "hasPassphrase", dbName: "has_passphrase", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "passwordEnc", dbName: "password_enc", kind: "text" },
      { field: "knownHostsPolicy", dbName: "known_hosts_policy", kind: "text", notNull: true, enumValues: ["strict","accept-new","no"], default: { kind: "value", value: "\"accept-new\"" } },
      { field: "extraOptions", dbName: "extra_options", kind: "json", typeBrand: "string[]" },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "lastUsedAt", dbName: "last_used_at", kind: "timestampMs" },
    ],
    indexes: [
      { name: "ssh_connection_user_project_idx", columns: ["userId","projectId"] },
    ],
  },
  // ===========================================================================
  // [oyej] Agent automation & orchestration platform (epic remote-dev-oyej).
  // Scheduled/triggered REAL agent runs, GitHub-webhook trigger configs, and
  // Crown best-of-N. These are DISTINCT from the keystroke-only
  // sessionSchedules/scheduleCommands above: an agent RUN creates a fresh
  // `terminalType:"agent"` session (autoLaunchAgent) + delivers a prompt,
  // rather than sending keystrokes to an existing session.
  // ===========================================================================
  {
    // GitHub-webhook trigger configs (declared before agentRuns so the FK
    // target exists; lazy `.references(() => ...)` makes order non-load-bearing
    // at runtime, but this keeps the file readable).
    exportName: "triggerConfigs",
    sqlName: "trigger_config",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "projectId", dbName: "project_id", kind: "text", notNull: true, references: { table: "projects", column: "id", onDelete: "cascade" } },
      { field: "githubRepoId", dbName: "github_repo_id", kind: "text", references: { table: "githubRepositories", column: "id", onDelete: "cascade" } },
      { field: "name", dbName: "name", kind: "text", notNull: true },
      { field: "kind", dbName: "kind", kind: "text", notNull: true, typeBrand: "TriggerKind" },
      // Filter JSON, e.g. {"label":"agent:fix"} for pr_labeled.
      { field: "filter", dbName: "filter", kind: "text", notNull: true, default: { kind: "value", value: "\"{}\"" } },
      { field: "agentProvider", dbName: "agent_provider", kind: "text", notNull: true, default: { kind: "value", value: "\"claude\"" } },
      { field: "agentFlags", dbName: "agent_flags", kind: "text", notNull: true, default: { kind: "value", value: "\"[]\"" } },
      // {{repo}} {{prNumber}} {{issueNumber}} placeholders.
      { field: "promptTemplate", dbName: "prompt_template", kind: "text", notNull: true },
      { field: "worktreeType", dbName: "worktree_type", kind: "text" },
      // Pinned Claude profile for triggered runs (schema only in P1; wiring is
      // P2 / remote-dev-vk1z). Set null on profile delete. [remote-dev-3b3l]
      { field: "profileId", dbName: "profile_id", kind: "text", references: { table: "agentProfiles", column: "id", onDelete: "set null" } },
      { field: "enabled", dbName: "enabled", kind: "boolean", notNull: true, default: { kind: "value", value: "true" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "trigger_config_user_idx", columns: ["userId"] },
      { name: "trigger_config_repo_idx", columns: ["githubRepoId"] },
    ],
  },
  {
    // Scheduled REAL agent launches (distinct from keystroke-only
    // sessionSchedules). Cron columns mirror sessionSchedules.
    exportName: "agentSchedules",
    sqlName: "agent_schedule",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "projectId", dbName: "project_id", kind: "text", notNull: true, references: { table: "projects", column: "id", onDelete: "cascade" } },
      { field: "name", dbName: "name", kind: "text", notNull: true },
      // Launch template.
      { field: "agentProvider", dbName: "agent_provider", kind: "text", notNull: true, default: { kind: "value", value: "\"claude\"" } },
      { field: "agentFlags", dbName: "agent_flags", kind: "text", notNull: true, default: { kind: "value", value: "\"[]\"" } },
      { field: "prompt", dbName: "prompt", kind: "text", notNull: true },
      { field: "worktreeType", dbName: "worktree_type", kind: "text" },
      { field: "baseBranch", dbName: "base_branch", kind: "text" },
      // Pinned Claude profile for scheduled runs (schema only in P1; wiring is
      // P2 / remote-dev-vk1z). Set null on profile delete. [remote-dev-3b3l]
      { field: "profileId", dbName: "profile_id", kind: "text", references: { table: "agentProfiles", column: "id", onDelete: "set null" } },
      // Cron (mirrors sessionSchedules).
      { field: "scheduleType", dbName: "schedule_type", kind: "text", notNull: true, typeBrand: "ScheduleType", default: { kind: "value", value: "\"recurring\"" } },
      { field: "cronExpression", dbName: "cron_expression", kind: "text" },
      { field: "scheduledAt", dbName: "scheduled_at", kind: "timestampMs" },
      { field: "timezone", dbName: "timezone", kind: "text", notNull: true, default: { kind: "value", value: "\"America/Los_Angeles\"" } },
      { field: "enabled", dbName: "enabled", kind: "boolean", notNull: true, default: { kind: "value", value: "true" } },
      { field: "status", dbName: "status", kind: "text", notNull: true, typeBrand: "ScheduleStatus", default: { kind: "value", value: "\"active\"" } },
      { field: "maxRetries", dbName: "max_retries", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "nextRunAt", dbName: "next_run_at", kind: "timestampMs" },
      { field: "lastRunAt", dbName: "last_run_at", kind: "timestampMs" },
      { field: "consecutiveFailures", dbName: "consecutive_failures", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "agent_schedule_user_idx", columns: ["userId"] },
      { name: "agent_schedule_next_run_idx", columns: ["enabled","nextRunAt"] },
    ],
  },
  {
    // One agent-run instance, regardless of trigger source
    // (schedule | trigger | manual | crown).
    exportName: "agentRuns",
    sqlName: "agent_run",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "projectId", dbName: "project_id", kind: "text", notNull: true, references: { table: "projects", column: "id", onDelete: "cascade" } },
      // Provenance — exactly one of these is set (others null).
      { field: "scheduleId", dbName: "schedule_id", kind: "text", references: { table: "agentSchedules", column: "id", onDelete: "set null" } },
      { field: "triggerConfigId", dbName: "trigger_config_id", kind: "text", references: { table: "triggerConfigs", column: "id", onDelete: "set null" } },
      { field: "source", dbName: "source", kind: "text", notNull: true, typeBrand: "AgentRunSource" },
      // Launch params snapshot.
      { field: "agentProvider", dbName: "agent_provider", kind: "text", notNull: true },
      { field: "agentFlags", dbName: "agent_flags", kind: "text", notNull: true, default: { kind: "value", value: "\"[]\"" } },
      // Claude profile this run launched under (schema only in P1; wiring is
      // P2 / remote-dev-vk1z). Set null on profile delete. [remote-dev-3b3l]
      { field: "profileId", dbName: "profile_id", kind: "text", references: { table: "agentProfiles", column: "id", onDelete: "set null" } },
      { field: "prompt", dbName: "prompt", kind: "text", notNull: true },
      // The session this run created (null until launched).
      { field: "sessionId", dbName: "session_id", kind: "text", references: { table: "terminalSessions", column: "id", onDelete: "set null" } },
      // Dedupe key for trigger runs: the GitHub head SHA (null for schedule/manual).
      { field: "headSha", dbName: "head_sha", kind: "text" },
      { field: "status", dbName: "status", kind: "text", notNull: true, typeBrand: "AgentRunStatus", default: { kind: "value", value: "\"pending\"" } },
      { field: "errorMessage", dbName: "error_message", kind: "text" },
      { field: "startedAt", dbName: "started_at", kind: "timestampMs" },
      { field: "completedAt", dbName: "completed_at", kind: "timestampMs" },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "agent_run_user_idx", columns: ["userId"] },
      { name: "agent_run_schedule_idx", columns: ["scheduleId"] },
      { name: "agent_run_trigger_idx", columns: ["triggerConfigId"] },
      { name: "agent_run_status_idx", columns: ["status"] },
      // Per-(triggerConfig, headSha) dedupe — nullable-composite: NULL headSha
      // (schedule/manual runs) never collide (NULLs distinct in SQLite + PG).
      { name: "agent_run_trigger_head_idx", columns: ["triggerConfigId","headSha"], unique: true },
    ],
  },
  {
    // Append-only log of inbound matched events (audit + dedupe support).
    exportName: "triggerEvents",
    sqlName: "trigger_event",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "triggerConfigId", dbName: "trigger_config_id", kind: "text", notNull: true, references: { table: "triggerConfigs", column: "id", onDelete: "cascade" } },
      { field: "eventKind", dbName: "event_kind", kind: "text", notNull: true },
      { field: "action", dbName: "action", kind: "text" },
      { field: "headSha", dbName: "head_sha", kind: "text" },
      { field: "matched", dbName: "matched", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "runId", dbName: "run_id", kind: "text", references: { table: "agentRuns", column: "id", onDelete: "set null" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "trigger_event_config_idx", columns: ["triggerConfigId"] },
    ],
  },
  {
    // Replay/dedupe ledger for inbound GitHub webhook deliveries
    // (epic remote-dev-oyej.14). GitHub assigns a unique `X-GitHub-Delivery`
    // UUID per delivery and REUSES it on redelivery, so an atomic
    // insert-or-conflict on `deliveryId` lets the webhook layer process each
    // delivery at most once — covering issue/label events (headSha == null),
    // which the per-(triggerConfig, headSha) `agentRuns` unique index cannot.
    exportName: "webhookDeliveries",
    sqlName: "webhook_delivery",
    columns: [
      { field: "deliveryId", dbName: "delivery_id", kind: "text", primaryKey: true },
      { field: "eventKind", dbName: "event_kind", kind: "text", notNull: true },
      { field: "receivedAt", dbName: "received_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      // Supports retention pruning of old delivery rows.
      { name: "webhook_delivery_received_idx", columns: ["receivedAt"] },
    ],
  },
  {
    // Crown best-of-N run (same prompt → N agents → N branches → judge).
    exportName: "crownRuns",
    sqlName: "crown_run",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "projectId", dbName: "project_id", kind: "text", notNull: true, references: { table: "projects", column: "id", onDelete: "cascade" } },
      { field: "prompt", dbName: "prompt", kind: "text", notNull: true },
      { field: "agentProvider", dbName: "agent_provider", kind: "text", notNull: true, default: { kind: "value", value: "\"claude\"" } },
      { field: "candidateCount", dbName: "candidate_count", kind: "integer", notNull: true },
      { field: "judgeModel", dbName: "judge_model", kind: "text" },
      { field: "baseBranch", dbName: "base_branch", kind: "text" },
      { field: "status", dbName: "status", kind: "text", notNull: true, typeBrand: "CrownRunStatus", default: { kind: "value", value: "\"running\"" } },
      { field: "winnerCandidateId", dbName: "winner_candidate_id", kind: "text" },
      { field: "crownReason", dbName: "crown_reason", kind: "text" },
      { field: "prUrl", dbName: "pr_url", kind: "text" },
      { field: "errorMessage", dbName: "error_message", kind: "text" },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "crown_run_user_idx", columns: ["userId"] },
    ],
  },
  {
    exportName: "crownCandidates",
    sqlName: "crown_candidate",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "crownRunId", dbName: "crown_run_id", kind: "text", notNull: true, references: { table: "crownRuns", column: "id", onDelete: "cascade" } },
      { field: "runId", dbName: "run_id", kind: "text", references: { table: "agentRuns", column: "id", onDelete: "set null" } },
      { field: "branch", dbName: "branch", kind: "text", notNull: true },
      { field: "worktreePath", dbName: "worktree_path", kind: "text" },
      { field: "diff", dbName: "diff", kind: "text" },
      { field: "diffStats", dbName: "diff_stats", kind: "text" },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "crown_candidate_run_idx", columns: ["crownRunId"] },
    ],
  },
  // [oyej] end automation platform tables.

  // [x386] Agent-native chat & coordination (epic remote-dev-x386).
  // Delivery layer (durable inbox + per-recipient state machine) + awareness
  // layer (channel subscriptions + auto work-context with READ-ONLY bd join).
  {
    // Per-recipient delivery state for agent messages (durable inbox).
    // One row per (messageId, toSessionId). Broadcasts/channels fan out to one
    // row per subscribed recipient at send time. State advances
    // pending → delivered → acked so a dropped MCP push is recoverable by poll.
    exportName: "messageDelivery",
    sqlName: "message_delivery",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "messageId", dbName: "message_id", kind: "text", notNull: true, references: { table: "agentPeerMessages", column: "id", onDelete: "cascade" } },
      { field: "toSessionId", dbName: "to_session_id", kind: "text", notNull: true, references: { table: "terminalSessions", column: "id", onDelete: "cascade" } },
      { field: "projectId", dbName: "project_id", kind: "text", notNull: true },
      // pending = written, not yet pushed; delivered = pushed to a live MCP
      // socket or returned by a poll; acked = surfaced to the agent.
      { field: "state", dbName: "state", kind: "text", notNull: true, typeBrand: "\"pending\" | \"delivered\" | \"acked\"", default: { kind: "value", value: "\"pending\"" } },
      // How it reached the agent (for parity metrics + debugging).
      { field: "channelType", dbName: "channel_kind", kind: "text", typeBrand: "\"mcp_push\" | \"poll\" | null" },
      { field: "deliveredAt", dbName: "delivered_at", kind: "timestampMs" },
      { field: "ackedAt", dbName: "acked_at", kind: "timestampMs" },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "message_delivery_msg_session_idx", columns: ["messageId","toSessionId"], unique: true },
      // Replay/poll: "give me undelivered rows for this session, oldest first".
      { name: "message_delivery_session_state_idx", columns: ["toSessionId","state","createdAt"] },
    ],
  },
  {
    // Which sessions auto-receive a channel's non-direct messages. Absence of a
    // row means "direct/mention only" for that (channel, session).
    exportName: "channelSubscription",
    sqlName: "channel_subscription",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "channelId", dbName: "channel_id", kind: "text", notNull: true, references: { table: "channels", column: "id", onDelete: "cascade" } },
      { field: "sessionId", dbName: "session_id", kind: "text", notNull: true, references: { table: "terminalSessions", column: "id", onDelete: "cascade" } },
      // auto_deliver = push every channel message; direct_only = only @mentions/replies-to-me.
      { field: "mode", dbName: "mode", kind: "text", notNull: true, typeBrand: "\"auto_deliver\" | \"direct_only\"", default: { kind: "value", value: "\"auto_deliver\"" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "channel_subscription_unique_idx", columns: ["channelId","sessionId"], unique: true },
    ],
  },
  {
    // Last computed work-context snapshot per session (auto-derived; cache only).
    // The claimed bd-issue fields are a READ-ONLY mirror for display and are
    // NEVER written back to bd (bd remains the durable work tracker).
    exportName: "agentWorkContext",
    sqlName: "agent_work_context",
    columns: [
      { field: "sessionId", dbName: "session_id", kind: "text", primaryKey: true, references: { table: "terminalSessions", column: "id", onDelete: "cascade" } },
      { field: "projectId", dbName: "project_id", kind: "text", notNull: true },
      { field: "branch", dbName: "branch", kind: "text" },
      { field: "worktreePath", dbName: "worktree_path", kind: "text" },
      { field: "activityStatus", dbName: "activity_status", kind: "text" },
      { field: "claimedIssueId", dbName: "claimed_issue_id", kind: "text" },
      { field: "claimedIssueTitle", dbName: "claimed_issue_title", kind: "text" },
      { field: "joinConfidence", dbName: "join_confidence", kind: "text", typeBrand: "\"branch\" | \"project\" | \"none\"" },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "agent_work_context_project_idx", columns: ["projectId"] },
    ],
  },
  // [x386] end chat & coordination tables.

  // ===========================================================================
  // Server-to-server project migration (stage 1: schema + peer registry +
  // DB-row transfer; stage 2 adds chunked file transfer; stage 3 adds UI/CLI).
  // Source pushes to destination over HTTPS, authenticating with the
  // destination's API key held in the peer registry below.
  // ===========================================================================
  {
    // Registry of remote Remote Dev instances this instance can migrate
    // projects to. The destination API key (and optional Cloudflare Access
    // service-token secret) are encrypted at rest with src/lib/encryption.ts.
    exportName: "peerInstances",
    sqlName: "peer_instance",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "name", dbName: "name", kind: "text", notNull: true },
      { field: "baseUrl", dbName: "base_url", kind: "text", notNull: true },
      { field: "encryptedApiKey", dbName: "encrypted_api_key", kind: "text", notNull: true },
      // Optional Cloudflare Access service-token pair for peers behind CF Access.
      { field: "cfAccessClientId", dbName: "cf_access_client_id", kind: "text" },
      { field: "encryptedCfAccessSecret", dbName: "encrypted_cf_access_secret", kind: "text" },
      // JSON cache of the peer's GET /api/migration/capabilities response.
      { field: "capabilities", dbName: "capabilities", kind: "text" },
      { field: "lastSeenAt", dbName: "last_seen_at", kind: "timestampMs" },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "peer_instance_user_idx", columns: ["userId"] },
      { name: "peer_instance_user_name_unique", columns: ["userId","name"], unique: true },
    ],
  },
  {
    // SOURCE-side migration job state machine:
    // pending → running → db_done → files_done → verifying → completed
    // (DB-only migrations skip files_done; failed/aborted are terminal).
    // The include* toggles capture the chosen export scope; sizeEstimateBytes
    // (total archive bytes) + bytesTransferred drive the live progress bar.
    // peerInstanceId is `set null` (NOT cascade): deleting a peer preserves
    // completed-migration audit rows and never yanks a live job mid-push.
    exportName: "migrationJobs",
    sqlName: "migration_job",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "projectId", dbName: "project_id", kind: "text", notNull: true, references: { table: "projects", column: "id", onDelete: "cascade" } },
      { field: "peerInstanceId", dbName: "peer_instance_id", kind: "text", references: { table: "peerInstances", column: "id", onDelete: "set null" } },
      { field: "status", dbName: "status", kind: "text", notNull: true, typeBrand: "MigrationJobStatus", default: { kind: "value", value: "\"pending\"" } },
      { field: "workingTreeMode", dbName: "working_tree_mode", kind: "text", notNull: true, typeBrand: "MigrationWorkingTreeMode", default: { kind: "value", value: "\"full_tar\"" } },
      { field: "includeDotEnv", dbName: "include_dot_env", kind: "boolean", notNull: true, default: { kind: "value", value: "true" } },
      { field: "includeAgentCreds", dbName: "include_agent_creds", kind: "boolean", notNull: true, default: { kind: "value", value: "true" } },
      { field: "includeSshKeys", dbName: "include_ssh_keys", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "includeAgentSettings", dbName: "include_agent_settings", kind: "boolean", notNull: true, default: { kind: "value", value: "true" } },
      { field: "includeChannelHistory", dbName: "include_channel_history", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "removeSourceAfterVerify", dbName: "remove_source_after_verify", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "sizeEstimateBytes", dbName: "size_estimate_bytes", kind: "integer" },
      { field: "bytesTransferred", dbName: "bytes_transferred", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      // The project id the DESTINATION assigned (may differ on id collision).
      { field: "destProjectId", dbName: "dest_project_id", kind: "text" },
      { field: "bundleManifestJson", dbName: "bundle_manifest_json", kind: "text" },
      { field: "conflictReportJson", dbName: "conflict_report_json", kind: "text" },
      { field: "errorMessage", dbName: "error_message", kind: "text" },
      { field: "startedAt", dbName: "started_at", kind: "timestampMs" },
      { field: "completedAt", dbName: "completed_at", kind: "timestampMs" },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "migration_job_user_idx", columns: ["userId"] },
      { name: "migration_job_project_idx", columns: ["projectId"] },
      { name: "migration_job_user_status_idx", columns: ["userId","status"] },
    ],
  },
  {
    // DESTINATION-side import record. `id` is the SOURCE job id (correlation
    // key across the two instances) so it carries NO uuid default. Lifecycle:
    // staged → importing (DB bundle) → receiving (file chunks) → finalizing
    // (assemble + extract) → completed (failed terminal). chunksReceived/
    // totalChunks + stagingDir track the chunk-upload phase.
    exportName: "migrationImports",
    sqlName: "migration_import",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true },
      { field: "userId", dbName: "user_id", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "sourceInstanceUrl", dbName: "source_instance_url", kind: "text", notNull: true },
      { field: "status", dbName: "status", kind: "text", notNull: true, typeBrand: "MigrationImportStatus", default: { kind: "value", value: "\"staged\"" } },
      { field: "stagingDir", dbName: "staging_dir", kind: "text", notNull: true },
      { field: "chunksReceived", dbName: "chunks_received", kind: "integer", notNull: true, default: { kind: "value", value: "0" } },
      { field: "totalChunks", dbName: "total_chunks", kind: "integer" },
      { field: "importedProjectId", dbName: "imported_project_id", kind: "text" },
      { field: "manifestJson", dbName: "manifest_json", kind: "text" },
      // Import options + bookkeeping the file phase needs later (e.g. the
      // source→destination working-directory path mapping recorded by importDb).
      { field: "optionsJson", dbName: "options_json", kind: "text", notNull: true, default: { kind: "value", value: "\"{}\"" } },
      { field: "errorMessage", dbName: "error_message", kind: "text" },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "migration_import_status_idx", columns: ["status"] },
      { name: "migration_import_user_idx", columns: ["userId"] },
    ],
  },
  // end server-to-server migration tables.
];
