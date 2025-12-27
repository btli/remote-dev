CREATE TABLE `agent_activity_event` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text,
	`agent_provider` text,
	`event_type` text NOT NULL,
	`event_data` text,
	`duration` integer,
	`success` integer,
	`error_message` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `terminal_session`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `agent_activity_user_idx` ON `agent_activity_event` (`user_id`);--> statement-breakpoint
CREATE INDEX `agent_activity_session_idx` ON `agent_activity_event` (`session_id`);--> statement-breakpoint
CREATE INDEX `agent_activity_provider_idx` ON `agent_activity_event` (`user_id`,`agent_provider`);--> statement-breakpoint
CREATE INDEX `agent_activity_event_type_idx` ON `agent_activity_event` (`user_id`,`event_type`);--> statement-breakpoint
CREATE INDEX `agent_activity_created_idx` ON `agent_activity_event` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `agent_config` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`folder_id` text,
	`provider` text NOT NULL,
	`config_type` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `session_folder`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_config_user_idx` ON `agent_config` (`user_id`);--> statement-breakpoint
CREATE INDEX `agent_config_folder_idx` ON `agent_config` (`folder_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_config_unique_idx` ON `agent_config` (`user_id`,`folder_id`,`provider`,`config_type`);--> statement-breakpoint
CREATE TABLE `agent_daily_stats` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`agent_provider` text,
	`session_count` integer DEFAULT 0 NOT NULL,
	`command_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`total_duration` integer DEFAULT 0 NOT NULL,
	`tool_call_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_daily_stats_unique_idx` ON `agent_daily_stats` (`user_id`,`date`,`agent_provider`);--> statement-breakpoint
CREATE INDEX `agent_daily_stats_user_date_idx` ON `agent_daily_stats` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `agent_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`provider` text DEFAULT 'all' NOT NULL,
	`config_dir` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_profile_user_idx` ON `agent_profile` (`user_id`);--> statement-breakpoint
CREATE INDEX `agent_profile_default_idx` ON `agent_profile` (`user_id`,`is_default`);--> statement-breakpoint
CREATE TABLE `dev_server_health` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`is_healthy` integer DEFAULT false NOT NULL,
	`port` integer,
	`url` text,
	`last_health_check` integer,
	`crashed_at` integer,
	`crash_reason` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`cpu_percent` real,
	`memory_mb` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `terminal_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dev_server_health_session_id_unique` ON `dev_server_health` (`session_id`);--> statement-breakpoint
CREATE INDEX `dev_server_health_user_idx` ON `dev_server_health` (`user_id`);--> statement-breakpoint
CREATE INDEX `dev_server_health_session_idx` ON `dev_server_health` (`session_id`);--> statement-breakpoint
CREATE TABLE `folder_profile_link` (
	`folder_id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `session_folder`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `agent_profile`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `folder_profile_link_profile_idx` ON `folder_profile_link` (`profile_id`);--> statement-breakpoint
CREATE TABLE `folder_secrets_config` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_config` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_fetched_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `session_folder`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `folder_secrets_config_folder_user_idx` ON `folder_secrets_config` (`folder_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `folder_secrets_config_user_idx` ON `folder_secrets_config` (`user_id`);--> statement-breakpoint
CREATE TABLE `mcp_discovered_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`uri` text NOT NULL,
	`name` text,
	`description` text,
	`mime_type` text,
	`discovered_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `mcp_server`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mcp_discovered_resource_server_idx` ON `mcp_discovered_resource` (`server_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_discovered_resource_unique_idx` ON `mcp_discovered_resource` (`server_id`,`uri`);--> statement-breakpoint
CREATE TABLE `mcp_discovered_tool` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`input_schema` text,
	`discovered_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `mcp_server`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mcp_discovered_tool_server_idx` ON `mcp_discovered_tool` (`server_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_discovered_tool_unique_idx` ON `mcp_discovered_tool` (`server_id`,`name`);--> statement-breakpoint
CREATE TABLE `mcp_server` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`folder_id` text,
	`name` text NOT NULL,
	`transport` text DEFAULT 'stdio' NOT NULL,
	`command` text NOT NULL,
	`args` text DEFAULT '[]' NOT NULL,
	`env` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`auto_start` integer DEFAULT false NOT NULL,
	`last_health_check` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `session_folder`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mcp_server_user_idx` ON `mcp_server` (`user_id`);--> statement-breakpoint
CREATE INDEX `mcp_server_folder_idx` ON `mcp_server` (`folder_id`);--> statement-breakpoint
CREATE INDEX `mcp_server_enabled_idx` ON `mcp_server` (`user_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `profile_git_identity` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`user_name` text NOT NULL,
	`user_email` text NOT NULL,
	`ssh_key_path` text,
	`gpg_key_id` text,
	`github_username` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `agent_profile`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_git_identity_profile_id_unique` ON `profile_git_identity` (`profile_id`);--> statement-breakpoint
CREATE INDEX `profile_git_identity_profile_idx` ON `profile_git_identity` (`profile_id`);--> statement-breakpoint
CREATE TABLE `profile_secrets_config` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_config` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_fetched_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `agent_profile`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_secrets_config_profile_id_unique` ON `profile_secrets_config` (`profile_id`);--> statement-breakpoint
CREATE INDEX `profile_secrets_config_profile_idx` ON `profile_secrets_config` (`profile_id`);--> statement-breakpoint
CREATE INDEX `profile_secrets_config_user_idx` ON `profile_secrets_config` (`user_id`);--> statement-breakpoint
CREATE TABLE `session_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`folder_id` text,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `session_folder`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `session_memory_user_idx` ON `session_memory` (`user_id`);--> statement-breakpoint
CREATE INDEX `session_memory_folder_idx` ON `session_memory` (`folder_id`);--> statement-breakpoint
CREATE INDEX `session_memory_type_idx` ON `session_memory` (`user_id`,`type`);--> statement-breakpoint
CREATE TABLE `setup_config` (
	`id` text PRIMARY KEY NOT NULL,
	`working_directory` text NOT NULL,
	`next_port` integer DEFAULT 3000 NOT NULL,
	`terminal_port` integer DEFAULT 3001 NOT NULL,
	`wsl_distribution` text,
	`auto_start` integer DEFAULT true NOT NULL,
	`check_for_updates` integer DEFAULT true NOT NULL,
	`is_complete` integer DEFAULT false NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `folder_preferences` ADD `server_startup_command` text;--> statement-breakpoint
ALTER TABLE `folder_preferences` ADD `build_command` text;--> statement-breakpoint
ALTER TABLE `folder_preferences` ADD `run_build_before_start` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `terminal_session` ADD `profile_id` text REFERENCES agent_profile(id);--> statement-breakpoint
ALTER TABLE `terminal_session` ADD `agent_provider` text DEFAULT 'claude';--> statement-breakpoint
ALTER TABLE `terminal_session` ADD `session_type` text DEFAULT 'terminal' NOT NULL;--> statement-breakpoint
ALTER TABLE `terminal_session` ADD `dev_server_port` integer;--> statement-breakpoint
ALTER TABLE `terminal_session` ADD `dev_server_status` text;--> statement-breakpoint
ALTER TABLE `terminal_session` ADD `dev_server_url` text;--> statement-breakpoint
CREATE INDEX `terminal_session_dev_server_folder_idx` ON `terminal_session` (`folder_id`,`session_type`);