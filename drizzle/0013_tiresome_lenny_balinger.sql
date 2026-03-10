CREATE TABLE `notification_event` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text,
	`session_name` text,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`read_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `terminal_session`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `notification_event_user_created_idx` ON `notification_event` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notification_event_user_read_idx` ON `notification_event` (`user_id`,`read_at`);--> statement-breakpoint
CREATE TABLE `task_dependency` (
	`blocker_id` text NOT NULL,
	`blocked_id` text NOT NULL,
	PRIMARY KEY(`blocker_id`, `blocked_id`),
	FOREIGN KEY (`blocker_id`) REFERENCES `project_task`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blocked_id`) REFERENCES `project_task`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_dep_blocker_idx` ON `task_dependency` (`blocker_id`);--> statement-breakpoint
CREATE INDEX `task_dep_blocked_idx` ON `task_dependency` (`blocked_id`);--> statement-breakpoint
ALTER TABLE `folder_preferences` ADD `default_agent_provider` text;--> statement-breakpoint
ALTER TABLE `github_issue` ADD `is_pull_request` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `project_task` ADD `metadata` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_task` ADD `instructions` text;--> statement-breakpoint
ALTER TABLE `project_task` ADD `agent_task_key` text;--> statement-breakpoint
ALTER TABLE `project_task` ADD `owner` text;--> statement-breakpoint
CREATE INDEX `project_task_agent_key_idx` ON `project_task` (`session_id`,`agent_task_key`);--> statement-breakpoint
ALTER TABLE `terminal_session` ADD `worktree_type` text;--> statement-breakpoint
ALTER TABLE `terminal_session` ADD `agent_activity_status` text;--> statement-breakpoint
ALTER TABLE `terminal_session` ADD `parent_session_id` text;--> statement-breakpoint
ALTER TABLE `terminal_session` ADD `orchestrator_role` text;--> statement-breakpoint
CREATE INDEX `terminal_session_parent_idx` ON `terminal_session` (`parent_session_id`);--> statement-breakpoint
ALTER TABLE `user_settings` ADD `notifications_enabled` integer DEFAULT true NOT NULL;