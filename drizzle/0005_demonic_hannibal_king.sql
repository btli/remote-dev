CREATE TABLE `folder_repository` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `session_folder`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `github_repository`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `folder_repo_folder_user_idx` ON `folder_repository` (`folder_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `folder_repo_user_idx` ON `folder_repository` (`user_id`);--> statement-breakpoint
CREATE TABLE `github_branch_protection` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`branch` text NOT NULL,
	`is_protected` integer DEFAULT false NOT NULL,
	`requires_review` integer DEFAULT false NOT NULL,
	`required_reviewers` integer DEFAULT 0 NOT NULL,
	`requires_status_checks` integer DEFAULT false NOT NULL,
	`required_checks` text,
	`allows_force_pushes` integer DEFAULT false NOT NULL,
	`allows_deletions` integer DEFAULT false NOT NULL,
	`cached_at` integer NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `github_repository`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_branch_protection_repo_branch_idx` ON `github_branch_protection` (`repository_id`,`branch`);--> statement-breakpoint
CREATE TABLE `github_change_notification` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`new_pr_count` integer DEFAULT 0 NOT NULL,
	`new_issue_count` integer DEFAULT 0 NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `github_repository`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_notifications_user_repo_idx` ON `github_change_notification` (`user_id`,`repository_id`);--> statement-breakpoint
CREATE INDEX `github_notifications_user_idx` ON `github_change_notification` (`user_id`);--> statement-breakpoint
CREATE TABLE `github_pull_request` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`pr_number` integer NOT NULL,
	`title` text NOT NULL,
	`state` text NOT NULL,
	`branch` text NOT NULL,
	`base_branch` text NOT NULL,
	`author` text NOT NULL,
	`author_avatar_url` text,
	`url` text NOT NULL,
	`is_draft` integer DEFAULT false NOT NULL,
	`additions` integer DEFAULT 0 NOT NULL,
	`deletions` integer DEFAULT 0 NOT NULL,
	`review_decision` text,
	`ci_status` text,
	`is_new` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`cached_at` integer NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `github_repository`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `github_pr_repo_idx` ON `github_pull_request` (`repository_id`);--> statement-breakpoint
CREATE INDEX `github_pr_repo_number_idx` ON `github_pull_request` (`repository_id`,`pr_number`);--> statement-breakpoint
CREATE INDEX `github_pr_state_idx` ON `github_pull_request` (`repository_id`,`state`);--> statement-breakpoint
CREATE TABLE `github_repository_stats` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`open_pr_count` integer DEFAULT 0 NOT NULL,
	`open_issue_count` integer DEFAULT 0 NOT NULL,
	`ci_status` text,
	`ci_status_details` text,
	`branch_protected` integer DEFAULT false NOT NULL,
	`branch_protection_details` text,
	`recent_commits` text,
	`cached_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `github_repository`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_repository_stats_repository_id_unique` ON `github_repository_stats` (`repository_id`);--> statement-breakpoint
CREATE INDEX `github_repo_stats_repo_idx` ON `github_repository_stats` (`repository_id`);--> statement-breakpoint
CREATE INDEX `github_repo_stats_expires_idx` ON `github_repository_stats` (`expires_at`);--> statement-breakpoint
CREATE TABLE `github_stats_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`folder_id` text,
	`show_pr_count` integer DEFAULT true NOT NULL,
	`show_issue_count` integer DEFAULT true NOT NULL,
	`show_ci_status` integer DEFAULT true NOT NULL,
	`show_recent_commits` integer DEFAULT true NOT NULL,
	`show_branch_protection` integer DEFAULT true NOT NULL,
	`refresh_interval_minutes` integer DEFAULT 15 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `session_folder`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_stats_prefs_user_folder_idx` ON `github_stats_preferences` (`user_id`,`folder_id`);--> statement-breakpoint
CREATE INDEX `github_stats_prefs_user_idx` ON `github_stats_preferences` (`user_id`);--> statement-breakpoint
DROP INDEX `folder_preferences_folder_id_unique`;--> statement-breakpoint
DROP INDEX `folder_prefs_folder_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `folder_prefs_folder_user_idx` ON `folder_preferences` (`folder_id`,`user_id`);