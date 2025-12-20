CREATE TABLE `account` (
	`userId` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`providerAccountId` text NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` integer,
	`token_type` text,
	`scope` text,
	`id_token` text,
	`session_state` text,
	PRIMARY KEY(`provider`, `providerAccountId`),
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `authorized_user` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `authorized_user_email_unique` ON `authorized_user` (`email`);--> statement-breakpoint
CREATE TABLE `folder_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_id` text NOT NULL,
	`user_id` text NOT NULL,
	`default_working_directory` text,
	`default_shell` text,
	`theme` text,
	`font_size` integer,
	`font_family` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `session_folder`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `folder_preferences_folder_id_unique` ON `folder_preferences` (`folder_id`);--> statement-breakpoint
CREATE INDEX `folder_prefs_user_idx` ON `folder_preferences` (`user_id`);--> statement-breakpoint
CREATE INDEX `folder_prefs_folder_idx` ON `folder_preferences` (`folder_id`);--> statement-breakpoint
CREATE TABLE `github_repository` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`github_id` integer NOT NULL,
	`name` text NOT NULL,
	`full_name` text NOT NULL,
	`clone_url` text NOT NULL,
	`default_branch` text NOT NULL,
	`local_path` text,
	`is_private` integer DEFAULT false NOT NULL,
	`added_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `github_repo_user_idx` ON `github_repository` (`user_id`);--> statement-breakpoint
CREATE INDEX `github_repo_github_id_idx` ON `github_repository` (`user_id`,`github_id`);--> statement-breakpoint
CREATE TABLE `session_folder` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`collapsed` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_folder_user_idx` ON `session_folder` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`sessionToken` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `terminal_session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`tmux_session_name` text NOT NULL,
	`project_path` text,
	`github_repo_id` text,
	`worktree_branch` text,
	`folder_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`tab_order` integer DEFAULT 0 NOT NULL,
	`last_activity_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`github_repo_id`) REFERENCES `github_repository`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`folder_id`) REFERENCES `session_folder`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `terminal_session_tmux_session_name_unique` ON `terminal_session` (`tmux_session_name`);--> statement-breakpoint
CREATE INDEX `terminal_session_user_status_idx` ON `terminal_session` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `terminal_session_user_order_idx` ON `terminal_session` (`user_id`,`tab_order`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`default_working_directory` text,
	`default_shell` text,
	`theme` text DEFAULT 'tokyo-night',
	`font_size` integer DEFAULT 14,
	`font_family` text DEFAULT '''JetBrains Mono'', monospace',
	`active_folder_id` text,
	`pinned_folder_id` text,
	`auto_follow_active_session` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_settings_user_id_unique` ON `user_settings` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text,
	`emailVerified` integer,
	`image` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verificationToken` (
	`identifier` text NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL,
	PRIMARY KEY(`identifier`, `token`)
);
