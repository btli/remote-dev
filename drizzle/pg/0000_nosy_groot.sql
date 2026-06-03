CREATE TABLE "account" (
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "account_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "agent_activity_event" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text,
	"agent_provider" text,
	"event_type" text NOT NULL,
	"event_data" text,
	"duration" integer,
	"success" boolean,
	"error_message" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_config" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text,
	"provider" text NOT NULL,
	"config_type" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_daily_stats" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"date" text NOT NULL,
	"agent_provider" text,
	"session_count" integer DEFAULT 0 NOT NULL,
	"command_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"total_duration" integer DEFAULT 0 NOT NULL,
	"tool_call_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_peer_message" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"from_session_id" text,
	"from_session_name" text NOT NULL,
	"to_session_id" text,
	"body" text NOT NULL,
	"is_user_message" boolean DEFAULT false NOT NULL,
	"channel_id" text,
	"parent_message_id" text,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_profile_json_config" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"user_id" text NOT NULL,
	"agent_type" text NOT NULL,
	"config_json" text DEFAULT '{}' NOT NULL,
	"is_valid" boolean DEFAULT true NOT NULL,
	"validation_errors" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"provider" text DEFAULT 'all' NOT NULL,
	"config_dir" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_key" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appearance_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"appearance_mode" text DEFAULT 'system' NOT NULL,
	"light_color_scheme" text DEFAULT 'ocean' NOT NULL,
	"dark_color_scheme" text DEFAULT 'midnight' NOT NULL,
	"terminal_opacity" integer DEFAULT 100 NOT NULL,
	"terminal_blur" integer DEFAULT 0 NOT NULL,
	"terminal_cursor_style" text DEFAULT 'block' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "appearance_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "authorized_user" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "authorized_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "channel_group" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_read_state" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_read_message_id" text,
	"last_read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "channel" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"group_id" text NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"type" text DEFAULT 'public' NOT NULL,
	"topic" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by_session_id" text,
	"last_message_at" timestamp with time zone,
	"message_count" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "color_scheme" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"color_definitions" text NOT NULL,
	"terminal_palette" text,
	"is_built_in" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "command_execution" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_id" text NOT NULL,
	"command_id" text NOT NULL,
	"command" text NOT NULL,
	"status" text NOT NULL,
	"exit_code" integer,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"output" text,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "github_account_metadata" (
	"provider_account_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"login" text NOT NULL,
	"display_name" text,
	"avatar_url" text NOT NULL,
	"email" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"config_dir" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_branch_protection" (
	"id" text PRIMARY KEY NOT NULL,
	"repository_id" text NOT NULL,
	"branch" text NOT NULL,
	"is_protected" boolean DEFAULT false NOT NULL,
	"requires_review" boolean DEFAULT false NOT NULL,
	"required_reviewers" integer DEFAULT 0 NOT NULL,
	"requires_status_checks" boolean DEFAULT false NOT NULL,
	"required_checks" text,
	"allows_force_pushes" boolean DEFAULT false NOT NULL,
	"allows_deletions" boolean DEFAULT false NOT NULL,
	"cached_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_change_notification" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"new_pr_count" integer DEFAULT 0 NOT NULL,
	"new_issue_count" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_issue" (
	"id" text PRIMARY KEY NOT NULL,
	"repository_id" text NOT NULL,
	"issue_number" integer NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"body" text,
	"html_url" text NOT NULL,
	"author" text,
	"labels" text DEFAULT '[]' NOT NULL,
	"assignees" text DEFAULT '[]' NOT NULL,
	"milestone" text,
	"comments" integer DEFAULT 0 NOT NULL,
	"is_pull_request" boolean DEFAULT false NOT NULL,
	"is_new" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"cached_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_pull_request" (
	"id" text PRIMARY KEY NOT NULL,
	"repository_id" text NOT NULL,
	"pr_number" integer NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"branch" text NOT NULL,
	"base_branch" text NOT NULL,
	"author" text NOT NULL,
	"author_avatar_url" text,
	"url" text NOT NULL,
	"is_draft" boolean DEFAULT false NOT NULL,
	"additions" integer DEFAULT 0 NOT NULL,
	"deletions" integer DEFAULT 0 NOT NULL,
	"review_decision" text,
	"ci_status" text,
	"is_new" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"cached_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_repository" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"github_id" integer NOT NULL,
	"name" text NOT NULL,
	"full_name" text NOT NULL,
	"clone_url" text NOT NULL,
	"default_branch" text NOT NULL,
	"local_path" text,
	"is_private" boolean DEFAULT false NOT NULL,
	"added_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_repository_stats" (
	"id" text PRIMARY KEY NOT NULL,
	"repository_id" text NOT NULL,
	"open_pr_count" integer DEFAULT 0 NOT NULL,
	"open_issue_count" integer DEFAULT 0 NOT NULL,
	"ci_status" text,
	"ci_status_details" text,
	"branch_protected" boolean DEFAULT false NOT NULL,
	"branch_protection_details" text,
	"recent_commits" text,
	"cached_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "github_repository_stats_repository_id_unique" UNIQUE("repository_id")
);
--> statement-breakpoint
CREATE TABLE "github_stats_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text,
	"show_pr_count" boolean DEFAULT true NOT NULL,
	"show_issue_count" boolean DEFAULT true NOT NULL,
	"show_ci_status" boolean DEFAULT true NOT NULL,
	"show_recent_commits" boolean DEFAULT true NOT NULL,
	"show_branch_protection" boolean DEFAULT true NOT NULL,
	"refresh_interval_minutes" integer DEFAULT 15 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "litellm_config" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"auto_start" boolean DEFAULT true NOT NULL,
	"port" integer DEFAULT 4000 NOT NULL,
	"master_key" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "litellm_config_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "litellm_model" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"model_name" text NOT NULL,
	"provider" text NOT NULL,
	"litellm_model" text NOT NULL,
	"api_base" text,
	"encrypted_api_key" text,
	"key_prefix" text,
	"extra_headers" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_discovered_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"uri" text NOT NULL,
	"name" text,
	"description" text,
	"mime_type" text,
	"discovered_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_discovered_tool" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"input_schema" text,
	"discovered_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_server" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text,
	"name" text NOT NULL,
	"transport" text DEFAULT 'stdio' NOT NULL,
	"command" text NOT NULL,
	"args" text DEFAULT '[]' NOT NULL,
	"env" text DEFAULT '{}' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"auto_start" boolean DEFAULT false NOT NULL,
	"last_health_check" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"owner_type" text NOT NULL,
	"user_id" text NOT NULL,
	"default_working_directory" text,
	"default_shell" text,
	"startup_command" text,
	"theme" text,
	"font_size" integer,
	"font_family" text,
	"github_repo_id" text,
	"local_repo_path" text,
	"default_agent_provider" text,
	"agent_provider_settings" jsonb,
	"environment_vars" jsonb,
	"pinned_files" jsonb,
	"git_identity_name" text,
	"git_identity_email" text,
	"is_sensitive" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_event" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text,
	"session_name" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "port_registry" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"user_id" text NOT NULL,
	"port" integer NOT NULL,
	"variable_name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_appearance_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"user_id" text NOT NULL,
	"appearance_mode" text DEFAULT 'system' NOT NULL,
	"light_color_scheme" text DEFAULT 'ocean' NOT NULL,
	"dark_color_scheme" text DEFAULT 'midnight' NOT NULL,
	"terminal_opacity" integer DEFAULT 100 NOT NULL,
	"terminal_blur" integer DEFAULT 0 NOT NULL,
	"terminal_cursor_style" text DEFAULT 'block' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "profile_appearance_settings_profile_id_unique" UNIQUE("profile_id")
);
--> statement-breakpoint
CREATE TABLE "profile_git_identity" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"user_name" text NOT NULL,
	"user_email" text NOT NULL,
	"ssh_key_path" text,
	"gpg_key_id" text,
	"github_username" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "profile_git_identity_profile_id_unique" UNIQUE("profile_id")
);
--> statement-breakpoint
CREATE TABLE "profile_secrets_config" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_config" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "profile_secrets_config_profile_id_unique" UNIQUE("profile_id")
);
--> statement-breakpoint
CREATE TABLE "project_github_account_link" (
	"project_id" text PRIMARY KEY NOT NULL,
	"provider_account_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_group" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"parent_group_id" text,
	"name" text NOT NULL,
	"collapsed" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_profile_link" (
	"project_id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_repository" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_secrets_config" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_config" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_task" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"session_id" text,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"labels" text DEFAULT '[]' NOT NULL,
	"subtasks" text DEFAULT '[]' NOT NULL,
	"metadata" text DEFAULT '{}' NOT NULL,
	"instructions" text,
	"agent_task_key" text,
	"owner" text,
	"due_date" timestamp with time zone,
	"github_issue_url" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"group_id" text,
	"name" text NOT NULL,
	"collapsed" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_auto_created" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_token" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"fcm_token" text NOT NULL,
	"platform" text NOT NULL,
	"device_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_command" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"command" text NOT NULL,
	"order" integer NOT NULL,
	"delay_before_seconds" integer DEFAULT 0 NOT NULL,
	"continue_on_error" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_execution" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"command_count" integer NOT NULL,
	"success_count" integer NOT NULL,
	"failure_count" integer NOT NULL,
	"error_message" text,
	"output" text
);
--> statement-breakpoint
CREATE TABLE "session_memory" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"tags" text DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_recording" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text,
	"name" text NOT NULL,
	"description" text,
	"duration" integer NOT NULL,
	"terminal_cols" integer DEFAULT 80 NOT NULL,
	"terminal_rows" integer DEFAULT 24 NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"name" text NOT NULL,
	"schedule_type" text DEFAULT 'one-time' NOT NULL,
	"cron_expression" text,
	"scheduled_at" timestamp with time zone,
	"timezone" text DEFAULT 'America/Los_Angeles' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"max_retries" integer DEFAULT 0 NOT NULL,
	"retry_delay_seconds" integer DEFAULT 60 NOT NULL,
	"timeout_seconds" integer DEFAULT 300 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_run_status" text,
	"next_run_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_template" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"session_name_pattern" text,
	"project_path" text,
	"startup_command" text,
	"project_id" text,
	"icon" text,
	"theme" text,
	"font_size" integer,
	"font_family" text,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setup_config" (
	"id" text PRIMARY KEY NOT NULL,
	"working_directory" text NOT NULL,
	"next_port" integer DEFAULT 3000 NOT NULL,
	"terminal_port" integer DEFAULT 3001 NOT NULL,
	"wsl_distribution" text,
	"auto_start" boolean DEFAULT true NOT NULL,
	"check_for_updates" boolean DEFAULT true NOT NULL,
	"is_complete" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ssh_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text,
	"name" text NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 22 NOT NULL,
	"username" text NOT NULL,
	"auth_type" text NOT NULL,
	"has_passphrase" boolean DEFAULT false NOT NULL,
	"password_enc" text,
	"known_hosts_policy" text DEFAULT 'accept-new' NOT NULL,
	"extra_options" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "system_update_cache" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"last_checked" timestamp with time zone,
	"cached_release_json" text,
	"deployment_state_json" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_dependency" (
	"blocker_id" text NOT NULL,
	"blocked_id" text NOT NULL,
	CONSTRAINT "task_dependency_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id")
);
--> statement-breakpoint
CREATE TABLE "terminal_session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"tmux_session_name" text NOT NULL,
	"project_path" text,
	"github_repo_id" text,
	"worktree_branch" text,
	"worktree_type" text,
	"project_id" text NOT NULL,
	"profile_id" text,
	"terminal_type" text DEFAULT 'shell',
	"agent_provider" text,
	"agent_exit_state" text,
	"agent_exit_code" integer,
	"agent_exited_at" timestamp with time zone,
	"agent_restart_count" integer DEFAULT 0,
	"agent_activity_status" text,
	"type_metadata" text,
	"scope_key" text,
	"parent_session_id" text,
	"orchestrator_role" text,
	"status" text DEFAULT 'active' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"tab_order" integer DEFAULT 0 NOT NULL,
	"last_activity_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "terminal_session_tmux_session_name_unique" UNIQUE("tmux_session_name")
);
--> statement-breakpoint
CREATE TABLE "trash_item" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"resource_name" text NOT NULL,
	"trashed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_email" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_email_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"default_working_directory" text,
	"default_shell" text,
	"startup_command" text,
	"xterm_scrollback" integer DEFAULT 10000,
	"tmux_history_limit" integer DEFAULT 50000,
	"theme" text DEFAULT 'tokyo-night',
	"font_size" integer DEFAULT 14,
	"font_family" text DEFAULT '''JetBrainsMono Nerd Font Mono'', monospace',
	"active_node_id" text,
	"active_node_type" text,
	"pinned_node_id" text,
	"pinned_node_type" text,
	"auto_follow_active_session" boolean DEFAULT true NOT NULL,
	"notifications_enabled" boolean DEFAULT true NOT NULL,
	"default_agent_provider" text,
	"agent_provider_settings" jsonb,
	"beads_sidebar_collapsed" boolean DEFAULT true NOT NULL,
	"beads_sidebar_width" integer DEFAULT 320,
	"beads_closed_retention_days" integer DEFAULT 7,
	"beads_section_expanded" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"emailVerified" timestamp with time zone,
	"image" text,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verificationToken" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verificationToken_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "worktree_trash_metadata" (
	"id" text PRIMARY KEY NOT NULL,
	"trash_item_id" text NOT NULL,
	"github_repo_id" text,
	"repo_name" text NOT NULL,
	"repo_local_path" text NOT NULL,
	"worktree_branch" text NOT NULL,
	"worktree_original_path" text NOT NULL,
	"worktree_trash_path" text NOT NULL,
	"original_project_id" text,
	"original_project_name" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "worktree_trash_metadata_trash_item_id_unique" UNIQUE("trash_item_id")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_activity_event" ADD CONSTRAINT "agent_activity_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_activity_event" ADD CONSTRAINT "agent_activity_event_session_id_terminal_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."terminal_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_config" ADD CONSTRAINT "agent_config_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_config" ADD CONSTRAINT "agent_config_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_daily_stats" ADD CONSTRAINT "agent_daily_stats_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_peer_message" ADD CONSTRAINT "agent_peer_message_from_session_id_terminal_session_id_fk" FOREIGN KEY ("from_session_id") REFERENCES "public"."terminal_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_peer_message" ADD CONSTRAINT "agent_peer_message_to_session_id_terminal_session_id_fk" FOREIGN KEY ("to_session_id") REFERENCES "public"."terminal_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_peer_message" ADD CONSTRAINT "agent_peer_message_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profile_json_config" ADD CONSTRAINT "agent_profile_json_config_profile_id_agent_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."agent_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profile_json_config" ADD CONSTRAINT "agent_profile_json_config_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD CONSTRAINT "agent_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appearance_settings" ADD CONSTRAINT "appearance_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_group" ADD CONSTRAINT "channel_group_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_read_state" ADD CONSTRAINT "channel_read_state_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_read_state" ADD CONSTRAINT "channel_read_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_group_id_channel_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."channel_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_execution" ADD CONSTRAINT "command_execution_execution_id_schedule_execution_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."schedule_execution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_execution" ADD CONSTRAINT "command_execution_command_id_schedule_command_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."schedule_command"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_account_metadata" ADD CONSTRAINT "github_account_metadata_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_branch_protection" ADD CONSTRAINT "github_branch_protection_repository_id_github_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."github_repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_change_notification" ADD CONSTRAINT "github_change_notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_change_notification" ADD CONSTRAINT "github_change_notification_repository_id_github_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."github_repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_issue" ADD CONSTRAINT "github_issue_repository_id_github_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."github_repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request" ADD CONSTRAINT "github_pull_request_repository_id_github_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."github_repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_repository" ADD CONSTRAINT "github_repository_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_repository_stats" ADD CONSTRAINT "github_repository_stats_repository_id_github_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."github_repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_stats_preferences" ADD CONSTRAINT "github_stats_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_stats_preferences" ADD CONSTRAINT "github_stats_preferences_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "litellm_config" ADD CONSTRAINT "litellm_config_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "litellm_model" ADD CONSTRAINT "litellm_model_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_discovered_resource" ADD CONSTRAINT "mcp_discovered_resource_server_id_mcp_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_server"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_discovered_tool" ADD CONSTRAINT "mcp_discovered_tool_server_id_mcp_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_server"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_server" ADD CONSTRAINT "mcp_server_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_server" ADD CONSTRAINT "mcp_server_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_preferences" ADD CONSTRAINT "node_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_event" ADD CONSTRAINT "notification_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_event" ADD CONSTRAINT "notification_event_session_id_terminal_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."terminal_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "port_registry" ADD CONSTRAINT "port_registry_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "port_registry" ADD CONSTRAINT "port_registry_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_appearance_settings" ADD CONSTRAINT "profile_appearance_settings_profile_id_agent_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."agent_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_appearance_settings" ADD CONSTRAINT "profile_appearance_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_git_identity" ADD CONSTRAINT "profile_git_identity_profile_id_agent_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."agent_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_secrets_config" ADD CONSTRAINT "profile_secrets_config_profile_id_agent_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."agent_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_secrets_config" ADD CONSTRAINT "profile_secrets_config_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_github_account_link" ADD CONSTRAINT "project_github_account_link_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_group" ADD CONSTRAINT "project_group_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_group" ADD CONSTRAINT "project_group_parent_group_id_project_group_id_fk" FOREIGN KEY ("parent_group_id") REFERENCES "public"."project_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_profile_link" ADD CONSTRAINT "project_profile_link_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_profile_link" ADD CONSTRAINT "project_profile_link_profile_id_agent_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."agent_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repository" ADD CONSTRAINT "project_repository_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repository" ADD CONSTRAINT "project_repository_repository_id_github_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."github_repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repository" ADD CONSTRAINT "project_repository_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_secrets_config" ADD CONSTRAINT "project_secrets_config_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_secrets_config" ADD CONSTRAINT "project_secrets_config_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task" ADD CONSTRAINT "project_task_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task" ADD CONSTRAINT "project_task_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task" ADD CONSTRAINT "project_task_session_id_terminal_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."terminal_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_group_id_project_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."project_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_token" ADD CONSTRAINT "push_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_command" ADD CONSTRAINT "schedule_command_schedule_id_session_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."session_schedule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_execution" ADD CONSTRAINT "schedule_execution_schedule_id_session_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."session_schedule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_memory" ADD CONSTRAINT "session_memory_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_memory" ADD CONSTRAINT "session_memory_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_recording" ADD CONSTRAINT "session_recording_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_schedule" ADD CONSTRAINT "session_schedule_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_schedule" ADD CONSTRAINT "session_schedule_session_id_terminal_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."terminal_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_template" ADD CONSTRAINT "session_template_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_template" ADD CONSTRAINT "session_template_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_connection" ADD CONSTRAINT "ssh_connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_connection" ADD CONSTRAINT "ssh_connection_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_blocker_id_project_task_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."project_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_blocked_id_project_task_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."project_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_session" ADD CONSTRAINT "terminal_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_session" ADD CONSTRAINT "terminal_session_github_repo_id_github_repository_id_fk" FOREIGN KEY ("github_repo_id") REFERENCES "public"."github_repository"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_session" ADD CONSTRAINT "terminal_session_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_session" ADD CONSTRAINT "terminal_session_profile_id_agent_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."agent_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trash_item" ADD CONSTRAINT "trash_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_email" ADD CONSTRAINT "user_email_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worktree_trash_metadata" ADD CONSTRAINT "worktree_trash_metadata_trash_item_id_trash_item_id_fk" FOREIGN KEY ("trash_item_id") REFERENCES "public"."trash_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worktree_trash_metadata" ADD CONSTRAINT "worktree_trash_metadata_github_repo_id_github_repository_id_fk" FOREIGN KEY ("github_repo_id") REFERENCES "public"."github_repository"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "agent_activity_user_idx" ON "agent_activity_event" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_activity_session_idx" ON "agent_activity_event" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "agent_activity_provider_idx" ON "agent_activity_event" USING btree ("user_id","agent_provider");--> statement-breakpoint
CREATE INDEX "agent_activity_event_type_idx" ON "agent_activity_event" USING btree ("user_id","event_type");--> statement-breakpoint
CREATE INDEX "agent_activity_created_idx" ON "agent_activity_event" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_config_user_idx" ON "agent_config" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_config_project_idx" ON "agent_config" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_config_unique_idx" ON "agent_config" USING btree ("user_id","project_id","provider","config_type");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_daily_stats_unique_idx" ON "agent_daily_stats" USING btree ("user_id","date","agent_provider");--> statement-breakpoint
CREATE INDEX "agent_daily_stats_user_date_idx" ON "agent_daily_stats" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "peer_message_project_created_idx" ON "agent_peer_message" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "peer_message_to_session_idx" ON "agent_peer_message" USING btree ("to_session_id");--> statement-breakpoint
CREATE INDEX "peer_message_channel_created_idx" ON "agent_peer_message" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "peer_message_parent_idx" ON "agent_peer_message" USING btree ("parent_message_id");--> statement-breakpoint
CREATE INDEX "agent_profile_json_config_profile_idx" ON "agent_profile_json_config" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "agent_profile_json_config_user_idx" ON "agent_profile_json_config" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_profile_json_config_unique_idx" ON "agent_profile_json_config" USING btree ("profile_id","agent_type");--> statement-breakpoint
CREATE INDEX "agent_profile_user_idx" ON "agent_profile" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_profile_default_idx" ON "agent_profile" USING btree ("user_id","is_default");--> statement-breakpoint
CREATE INDEX "api_key_user_idx" ON "api_key" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_key_prefix_idx" ON "api_key" USING btree ("key_prefix");--> statement-breakpoint
CREATE INDEX "appearance_settings_user_idx" ON "appearance_settings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "channel_group_project_idx" ON "channel_group" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_group_project_name_idx" ON "channel_group" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_read_state_unique_idx" ON "channel_read_state" USING btree ("channel_id","user_id");--> statement-breakpoint
CREATE INDEX "channel_read_state_user_idx" ON "channel_read_state" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "channel_project_idx" ON "channel" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "channel_group_idx" ON "channel" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_project_name_idx" ON "channel" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "color_scheme_category_idx" ON "color_scheme" USING btree ("category");--> statement-breakpoint
CREATE INDEX "color_scheme_sort_idx" ON "color_scheme" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "command_execution_execution_idx" ON "command_execution" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "command_execution_command_idx" ON "command_execution" USING btree ("command_id");--> statement-breakpoint
CREATE INDEX "github_account_metadata_user_idx" ON "github_account_metadata" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_branch_protection_repo_branch_idx" ON "github_branch_protection" USING btree ("repository_id","branch");--> statement-breakpoint
CREATE UNIQUE INDEX "github_notifications_user_repo_idx" ON "github_change_notification" USING btree ("user_id","repository_id");--> statement-breakpoint
CREATE INDEX "github_notifications_user_idx" ON "github_change_notification" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "github_issue_repo_idx" ON "github_issue" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_issue_repo_number_idx" ON "github_issue" USING btree ("repository_id","issue_number");--> statement-breakpoint
CREATE INDEX "github_issue_state_idx" ON "github_issue" USING btree ("repository_id","state");--> statement-breakpoint
CREATE INDEX "github_issue_cached_idx" ON "github_issue" USING btree ("cached_at");--> statement-breakpoint
CREATE INDEX "github_pr_repo_idx" ON "github_pull_request" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "github_pr_repo_number_idx" ON "github_pull_request" USING btree ("repository_id","pr_number");--> statement-breakpoint
CREATE INDEX "github_pr_state_idx" ON "github_pull_request" USING btree ("repository_id","state");--> statement-breakpoint
CREATE INDEX "github_repo_user_idx" ON "github_repository" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "github_repo_github_id_idx" ON "github_repository" USING btree ("user_id","github_id");--> statement-breakpoint
CREATE INDEX "github_repo_stats_repo_idx" ON "github_repository_stats" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "github_repo_stats_expires_idx" ON "github_repository_stats" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "github_stats_prefs_user_idx" ON "github_stats_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "github_stats_prefs_project_idx" ON "github_stats_preferences" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "litellm_model_user_idx" ON "litellm_model" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mcp_discovered_resource_server_idx" ON "mcp_discovered_resource" USING btree ("server_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_discovered_resource_unique_idx" ON "mcp_discovered_resource" USING btree ("server_id","uri");--> statement-breakpoint
CREATE INDEX "mcp_discovered_tool_server_idx" ON "mcp_discovered_tool" USING btree ("server_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_discovered_tool_unique_idx" ON "mcp_discovered_tool" USING btree ("server_id","name");--> statement-breakpoint
CREATE INDEX "mcp_server_user_idx" ON "mcp_server" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mcp_server_project_idx" ON "mcp_server" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "mcp_server_enabled_idx" ON "mcp_server" USING btree ("user_id","enabled");--> statement-breakpoint
CREATE INDEX "node_pref_owner_idx" ON "node_preferences" USING btree ("owner_id","owner_type");--> statement-breakpoint
CREATE UNIQUE INDEX "node_pref_owner_user_idx" ON "node_preferences" USING btree ("owner_id","owner_type","user_id");--> statement-breakpoint
CREATE INDEX "notification_event_user_created_idx" ON "notification_event" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_event_user_read_idx" ON "notification_event" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "port_registry_user_idx" ON "port_registry" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "port_registry_project_idx" ON "port_registry" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "port_registry_user_port_idx" ON "port_registry" USING btree ("user_id","port");--> statement-breakpoint
CREATE UNIQUE INDEX "port_registry_user_port_var_unique" ON "port_registry" USING btree ("user_id","port","variable_name");--> statement-breakpoint
CREATE INDEX "profile_appearance_profile_idx" ON "profile_appearance_settings" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "profile_appearance_user_idx" ON "profile_appearance_settings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "profile_git_identity_profile_idx" ON "profile_git_identity" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "profile_secrets_config_profile_idx" ON "profile_secrets_config" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "profile_secrets_config_user_idx" ON "profile_secrets_config" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_gh_link_account_idx" ON "project_github_account_link" USING btree ("provider_account_id");--> statement-breakpoint
CREATE INDEX "project_group_user_idx" ON "project_group" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_group_parent_idx" ON "project_group" USING btree ("parent_group_id");--> statement-breakpoint
CREATE INDEX "project_profile_link_profile_idx" ON "project_profile_link" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_repo_project_user_idx" ON "project_repository" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "project_repo_user_idx" ON "project_repository" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_secrets_project_user_idx" ON "project_secrets_config" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "project_task_user_idx" ON "project_task" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_task_project_idx" ON "project_task" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_task_user_project_idx" ON "project_task" USING btree ("user_id","project_id");--> statement-breakpoint
CREATE INDEX "project_task_session_idx" ON "project_task" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "project_task_agent_key_idx" ON "project_task" USING btree ("session_id","agent_task_key");--> statement-breakpoint
CREATE INDEX "project_user_idx" ON "project" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_group_idx" ON "project" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "push_token_user_idx" ON "push_token" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "push_token_fcm_token_idx" ON "push_token" USING btree ("fcm_token");--> statement-breakpoint
CREATE INDEX "schedule_command_schedule_idx" ON "schedule_command" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "schedule_command_order_idx" ON "schedule_command" USING btree ("schedule_id","order");--> statement-breakpoint
CREATE INDEX "schedule_execution_schedule_idx" ON "schedule_execution" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "schedule_execution_started_idx" ON "schedule_execution" USING btree ("schedule_id","started_at");--> statement-breakpoint
CREATE INDEX "session_memory_user_idx" ON "session_memory" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_memory_project_idx" ON "session_memory" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "session_memory_type_idx" ON "session_memory" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "session_recording_user_idx" ON "session_recording" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_recording_created_idx" ON "session_recording" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "session_schedule_user_idx" ON "session_schedule" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_schedule_session_idx" ON "session_schedule" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "session_schedule_next_run_idx" ON "session_schedule" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "session_template_user_idx" ON "session_template" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_template_usage_idx" ON "session_template" USING btree ("user_id","usage_count");--> statement-breakpoint
CREATE INDEX "session_template_project_idx" ON "session_template" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ssh_connection_user_project_idx" ON "ssh_connection" USING btree ("user_id","project_id");--> statement-breakpoint
CREATE INDEX "task_dep_blocker_idx" ON "task_dependency" USING btree ("blocker_id");--> statement-breakpoint
CREATE INDEX "task_dep_blocked_idx" ON "task_dependency" USING btree ("blocked_id");--> statement-breakpoint
CREATE INDEX "terminal_session_user_status_idx" ON "terminal_session" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "terminal_session_user_order_idx" ON "terminal_session" USING btree ("user_id","tab_order");--> statement-breakpoint
CREATE INDEX "terminal_session_project_idx" ON "terminal_session" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "terminal_session_type_idx" ON "terminal_session" USING btree ("user_id","terminal_type");--> statement-breakpoint
CREATE UNIQUE INDEX "terminal_session_scope_unique_idx" ON "terminal_session" ("user_id","terminal_type","scope_key") WHERE "scope_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "trash_item_user_type_idx" ON "trash_item" USING btree ("user_id","resource_type");--> statement-breakpoint
CREATE INDEX "trash_item_expires_idx" ON "trash_item" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "trash_item_resource_idx" ON "trash_item" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "user_email_user_idx" ON "user_email" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "worktree_trash_repo_idx" ON "worktree_trash_metadata" USING btree ("github_repo_id");