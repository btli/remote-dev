CREATE TABLE `delegations` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`session_id` text NOT NULL,
	`worktree_id` text,
	`agent_provider` text NOT NULL,
	`status` text DEFAULT 'spawning' NOT NULL,
	`context_injected` text,
	`execution_logs_json` text DEFAULT '[]' NOT NULL,
	`result_json` text,
	`error_json` text,
	`transcript_path` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `terminal_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `delegations_task_idx` ON `delegations` (`task_id`);--> statement-breakpoint
CREATE INDEX `delegations_session_idx` ON `delegations` (`session_id`);--> statement-breakpoint
CREATE INDEX `delegations_status_idx` ON `delegations` (`status`);--> statement-breakpoint
CREATE INDEX `delegations_agent_idx` ON `delegations` (`agent_provider`);--> statement-breakpoint
CREATE INDEX `delegations_task_status_idx` ON `delegations` (`task_id`,`status`);--> statement-breakpoint
CREATE TABLE `project_knowledge` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_id` text NOT NULL,
	`user_id` text NOT NULL,
	`tech_stack_json` text DEFAULT '[]' NOT NULL,
	`conventions_json` text DEFAULT '[]' NOT NULL,
	`agent_performance_json` text DEFAULT '{}' NOT NULL,
	`patterns_json` text DEFAULT '[]' NOT NULL,
	`skills_json` text DEFAULT '[]' NOT NULL,
	`tools_json` text DEFAULT '[]' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`last_scanned_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `session_folder`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_knowledge_folder_id_unique` ON `project_knowledge` (`folder_id`);--> statement-breakpoint
CREATE INDEX `project_knowledge_user_idx` ON `project_knowledge` (`user_id`);--> statement-breakpoint
CREATE INDEX `project_knowledge_scanned_idx` ON `project_knowledge` (`last_scanned_at`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`orchestrator_id` text NOT NULL,
	`user_id` text NOT NULL,
	`folder_id` text,
	`description` text NOT NULL,
	`type` text DEFAULT 'feature' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`confidence` real DEFAULT 1 NOT NULL,
	`estimated_duration` integer,
	`assigned_agent` text,
	`delegation_id` text,
	`beads_issue_id` text,
	`context_injected` text,
	`result_json` text,
	`error_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`orchestrator_id`) REFERENCES `orchestrator_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `session_folder`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tasks_orchestrator_idx` ON `tasks` (`orchestrator_id`);--> statement-breakpoint
CREATE INDEX `tasks_user_idx` ON `tasks` (`user_id`);--> statement-breakpoint
CREATE INDEX `tasks_folder_idx` ON `tasks` (`folder_id`);--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `tasks_beads_idx` ON `tasks` (`beads_issue_id`);--> statement-breakpoint
CREATE INDEX `tasks_orchestrator_status_idx` ON `tasks` (`orchestrator_id`,`status`);--> statement-breakpoint
CREATE INDEX `tasks_user_status_idx` ON `tasks` (`user_id`,`status`);