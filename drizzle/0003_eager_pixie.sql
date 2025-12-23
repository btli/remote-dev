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
CREATE UNIQUE INDEX `user_settings_user_id_unique` ON `user_settings` (`user_id`);