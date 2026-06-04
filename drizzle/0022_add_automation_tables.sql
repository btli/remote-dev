-- [oyej] Agent automation & orchestration platform (epic remote-dev-oyej).
--
-- Adds the six automation tables: trigger_config, agent_schedule, agent_run,
-- trigger_event, crown_run, crown_candidate. The SQLite path uses `db:push`
-- for fresh/dev databases; this hand-written migration mirrors the 0013-0021
-- raw-SQL convention (the generated dialect source is src/db/schema.sqlite.ts
-- via `bun run db:codegen`) so existing SQLite deployments can be upgraded in
-- place. Tables are created in FK-dependency order.
CREATE TABLE `trigger_config` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`github_repo_id` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`filter` text DEFAULT '{}' NOT NULL,
	`agent_provider` text DEFAULT 'claude' NOT NULL,
	`agent_flags` text DEFAULT '[]' NOT NULL,
	`prompt_template` text NOT NULL,
	`worktree_type` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`github_repo_id`) REFERENCES `github_repository`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trigger_config_user_idx` ON `trigger_config` (`user_id`);--> statement-breakpoint
CREATE INDEX `trigger_config_repo_idx` ON `trigger_config` (`github_repo_id`);--> statement-breakpoint
CREATE TABLE `agent_schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`agent_provider` text DEFAULT 'claude' NOT NULL,
	`agent_flags` text DEFAULT '[]' NOT NULL,
	`prompt` text NOT NULL,
	`worktree_type` text,
	`base_branch` text,
	`schedule_type` text DEFAULT 'recurring' NOT NULL,
	`cron_expression` text,
	`scheduled_at` integer,
	`timezone` text DEFAULT 'America/Los_Angeles' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`max_retries` integer DEFAULT 0 NOT NULL,
	`next_run_at` integer,
	`last_run_at` integer,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_schedule_user_idx` ON `agent_schedule` (`user_id`);--> statement-breakpoint
CREATE INDEX `agent_schedule_next_run_idx` ON `agent_schedule` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `agent_run` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`schedule_id` text,
	`trigger_config_id` text,
	`source` text NOT NULL,
	`agent_provider` text NOT NULL,
	`agent_flags` text DEFAULT '[]' NOT NULL,
	`prompt` text NOT NULL,
	`session_id` text,
	`head_sha` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_message` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`schedule_id`) REFERENCES `agent_schedule`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`trigger_config_id`) REFERENCES `trigger_config`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`) REFERENCES `terminal_session`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `agent_run_user_idx` ON `agent_run` (`user_id`);--> statement-breakpoint
CREATE INDEX `agent_run_schedule_idx` ON `agent_run` (`schedule_id`);--> statement-breakpoint
CREATE INDEX `agent_run_trigger_idx` ON `agent_run` (`trigger_config_id`);--> statement-breakpoint
CREATE INDEX `agent_run_status_idx` ON `agent_run` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_run_trigger_head_idx` ON `agent_run` (`trigger_config_id`,`head_sha`);--> statement-breakpoint
CREATE TABLE `trigger_event` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger_config_id` text NOT NULL,
	`event_kind` text NOT NULL,
	`action` text,
	`head_sha` text,
	`matched` integer DEFAULT false NOT NULL,
	`run_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`trigger_config_id`) REFERENCES `trigger_config`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `agent_run`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `trigger_event_config_idx` ON `trigger_event` (`trigger_config_id`);--> statement-breakpoint
CREATE TABLE `crown_run` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`prompt` text NOT NULL,
	`agent_provider` text DEFAULT 'claude' NOT NULL,
	`candidate_count` integer NOT NULL,
	`judge_model` text,
	`base_branch` text,
	`status` text DEFAULT 'running' NOT NULL,
	`winner_candidate_id` text,
	`crown_reason` text,
	`pr_url` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `crown_run_user_idx` ON `crown_run` (`user_id`);--> statement-breakpoint
CREATE TABLE `crown_candidate` (
	`id` text PRIMARY KEY NOT NULL,
	`crown_run_id` text NOT NULL,
	`run_id` text,
	`branch` text NOT NULL,
	`worktree_path` text,
	`diff` text,
	`diff_stats` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`crown_run_id`) REFERENCES `crown_run`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `agent_run`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `crown_candidate_run_idx` ON `crown_candidate` (`crown_run_id`);
