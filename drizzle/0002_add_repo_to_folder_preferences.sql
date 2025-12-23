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
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`default_working_directory` text,
	`default_shell` text,
	`startup_command` text,
	`theme` text DEFAULT 'tokyo-night',
	`font_size` integer DEFAULT 14,
	`font_family` text DEFAULT '''JetBrainsMono Nerd Font'', ''JetBrains Mono'', monospace',
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
ALTER TABLE `session_folder` ADD `parent_id` text;--> statement-breakpoint
CREATE INDEX `session_folder_parent_idx` ON `session_folder` (`parent_id`);