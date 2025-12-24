CREATE TABLE `api_key` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`key_prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `api_key_user_idx` ON `api_key` (`user_id`);--> statement-breakpoint
CREATE INDEX `api_key_prefix_idx` ON `api_key` (`key_prefix`);--> statement-breakpoint
CREATE TABLE `port_registry` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_id` text NOT NULL,
	`user_id` text NOT NULL,
	`port` integer NOT NULL,
	`variable_name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `session_folder`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `port_registry_user_idx` ON `port_registry` (`user_id`);--> statement-breakpoint
CREATE INDEX `port_registry_folder_idx` ON `port_registry` (`folder_id`);--> statement-breakpoint
CREATE INDEX `port_registry_user_port_idx` ON `port_registry` (`user_id`,`port`);--> statement-breakpoint
CREATE TABLE `session_recording` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text,
	`name` text NOT NULL,
	`description` text,
	`duration` integer NOT NULL,
	`terminal_cols` integer DEFAULT 80 NOT NULL,
	`terminal_rows` integer DEFAULT 24 NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_recording_user_idx` ON `session_recording` (`user_id`);--> statement-breakpoint
CREATE INDEX `session_recording_created_idx` ON `session_recording` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `session_template` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`session_name_pattern` text,
	`project_path` text,
	`startup_command` text,
	`folder_id` text,
	`icon` text,
	`theme` text,
	`font_size` integer,
	`font_family` text,
	`usage_count` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `session_folder`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `session_template_user_idx` ON `session_template` (`user_id`);--> statement-breakpoint
CREATE INDEX `session_template_usage_idx` ON `session_template` (`user_id`,`usage_count`);--> statement-breakpoint
CREATE TABLE `split_group` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`direction` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `split_group_user_idx` ON `split_group` (`user_id`);--> statement-breakpoint
CREATE TABLE `trash_item` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`resource_name` text NOT NULL,
	`trashed_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trash_item_user_type_idx` ON `trash_item` (`user_id`,`resource_type`);--> statement-breakpoint
CREATE INDEX `trash_item_expires_idx` ON `trash_item` (`expires_at`);--> statement-breakpoint
CREATE INDEX `trash_item_resource_idx` ON `trash_item` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE TABLE `worktree_trash_metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`trash_item_id` text NOT NULL,
	`github_repo_id` text,
	`repo_name` text NOT NULL,
	`repo_local_path` text NOT NULL,
	`worktree_branch` text NOT NULL,
	`worktree_original_path` text NOT NULL,
	`worktree_trash_path` text NOT NULL,
	`original_folder_id` text,
	`original_folder_name` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`trash_item_id`) REFERENCES `trash_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`github_repo_id`) REFERENCES `github_repository`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `worktree_trash_metadata_trash_item_id_unique` ON `worktree_trash_metadata` (`trash_item_id`);--> statement-breakpoint
CREATE INDEX `worktree_trash_repo_idx` ON `worktree_trash_metadata` (`github_repo_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`default_working_directory` text,
	`default_shell` text,
	`startup_command` text,
	`theme` text DEFAULT 'tokyo-night',
	`font_size` integer DEFAULT 14,
	`font_family` text DEFAULT '''JetBrainsMono Nerd Font Mono'', monospace',
	`active_folder_id` text,
	`pinned_folder_id` text,
	`auto_follow_active_session` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_user_settings`("id", "user_id", "default_working_directory", "default_shell", "startup_command", "theme", "font_size", "font_family", "active_folder_id", "pinned_folder_id", "auto_follow_active_session", "created_at", "updated_at") SELECT "id", "user_id", "default_working_directory", "default_shell", "startup_command", "theme", "font_size", "font_family", "active_folder_id", "pinned_folder_id", "auto_follow_active_session", "created_at", "updated_at" FROM `user_settings`;--> statement-breakpoint
DROP TABLE `user_settings`;--> statement-breakpoint
ALTER TABLE `__new_user_settings` RENAME TO `user_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `user_settings_user_id_unique` ON `user_settings` (`user_id`);--> statement-breakpoint
ALTER TABLE `folder_preferences` ADD `startup_command` text;--> statement-breakpoint
ALTER TABLE `folder_preferences` ADD `github_repo_id` text REFERENCES github_repository(id);--> statement-breakpoint
ALTER TABLE `folder_preferences` ADD `local_repo_path` text;--> statement-breakpoint
ALTER TABLE `folder_preferences` ADD `environment_vars` text;--> statement-breakpoint
ALTER TABLE `session_folder` ADD `parent_id` text;--> statement-breakpoint
CREATE INDEX `session_folder_parent_idx` ON `session_folder` (`parent_id`);--> statement-breakpoint
ALTER TABLE `terminal_session` ADD `split_group_id` text REFERENCES split_group(id);--> statement-breakpoint
ALTER TABLE `terminal_session` ADD `split_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `terminal_session` ADD `split_size` real DEFAULT 0.5;--> statement-breakpoint
CREATE INDEX `terminal_session_split_group_idx` ON `terminal_session` (`split_group_id`);--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `account` (`userId`);