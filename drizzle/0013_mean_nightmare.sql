CREATE TABLE `sdk_insight_application` (
	`id` text PRIMARY KEY NOT NULL,
	`insight_id` text NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`application_method` text NOT NULL,
	`feedback` integer,
	`feedback_comment` text,
	`applied_at` integer NOT NULL,
	`feedback_at` integer,
	FOREIGN KEY (`insight_id`) REFERENCES `sdk_insight`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `terminal_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sdk_insight_app_insight_idx` ON `sdk_insight_application` (`insight_id`);--> statement-breakpoint
CREATE INDEX `sdk_insight_app_session_idx` ON `sdk_insight_application` (`session_id`);--> statement-breakpoint
CREATE INDEX `sdk_insight_app_user_idx` ON `sdk_insight_application` (`user_id`);--> statement-breakpoint
CREATE INDEX `sdk_insight_app_feedback_idx` ON `sdk_insight_application` (`insight_id`,`feedback`);--> statement-breakpoint
CREATE TABLE `sdk_insight` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`folder_id` text,
	`type` text NOT NULL,
	`applicability` text DEFAULT 'folder' NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`applicability_context` text,
	`source_notes_json` text DEFAULT '[]' NOT NULL,
	`source_sessions_json` text DEFAULT '[]',
	`confidence` real DEFAULT 0.5 NOT NULL,
	`application_count` integer DEFAULT 0,
	`feedback_score` real DEFAULT 0,
	`embedding_id` text,
	`verified` integer DEFAULT false,
	`active` integer DEFAULT true,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_applied_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `session_folder`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `sdk_insight_user_idx` ON `sdk_insight` (`user_id`);--> statement-breakpoint
CREATE INDEX `sdk_insight_folder_idx` ON `sdk_insight` (`folder_id`);--> statement-breakpoint
CREATE INDEX `sdk_insight_type_idx` ON `sdk_insight` (`user_id`,`type`);--> statement-breakpoint
CREATE INDEX `sdk_insight_applicability_idx` ON `sdk_insight` (`user_id`,`applicability`);--> statement-breakpoint
CREATE INDEX `sdk_insight_confidence_idx` ON `sdk_insight` (`user_id`,`confidence`);--> statement-breakpoint
CREATE INDEX `sdk_insight_active_idx` ON `sdk_insight` (`user_id`,`active`);--> statement-breakpoint
CREATE INDEX `sdk_insight_embedding_idx` ON `sdk_insight` (`embedding_id`);--> statement-breakpoint
CREATE INDEX `sdk_insight_app_context_idx` ON `sdk_insight` (`applicability_context`);--> statement-breakpoint
CREATE TABLE `sdk_meta_agent_optimization_job` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`folder_id` text,
	`session_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`current_iteration` integer DEFAULT 0 NOT NULL,
	`max_iterations` integer DEFAULT 3 NOT NULL,
	`current_score` real,
	`target_score` real DEFAULT 0.9 NOT NULL,
	`task_spec_json` text NOT NULL,
	`project_context_json` text NOT NULL,
	`options_json` text NOT NULL,
	`config_id` text,
	`score_history_json` text DEFAULT '[]' NOT NULL,
	`iteration_history_json` text DEFAULT '[]' NOT NULL,
	`stop_reason` text,
	`error_message` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `session_folder`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`) REFERENCES `terminal_session`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`config_id`) REFERENCES `sdk_meta_agent_config`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `sdk_optimization_job_user_idx` ON `sdk_meta_agent_optimization_job` (`user_id`);--> statement-breakpoint
CREATE INDEX `sdk_optimization_job_status_idx` ON `sdk_meta_agent_optimization_job` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `sdk_optimization_job_folder_idx` ON `sdk_meta_agent_optimization_job` (`folder_id`);--> statement-breakpoint
CREATE INDEX `sdk_optimization_job_session_idx` ON `sdk_meta_agent_optimization_job` (`session_id`);--> statement-breakpoint
ALTER TABLE `sdk_note` ADD `type` text DEFAULT 'observation' NOT NULL;--> statement-breakpoint
ALTER TABLE `sdk_note` ADD `title` text;--> statement-breakpoint
ALTER TABLE `sdk_note` ADD `context_json` text DEFAULT '{}';--> statement-breakpoint
ALTER TABLE `sdk_note` ADD `priority` real DEFAULT 0.5;--> statement-breakpoint
ALTER TABLE `sdk_note` ADD `pinned` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `sdk_note` ADD `archived` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `sdk_note` ADD `updated_at` integer NOT NULL;--> statement-breakpoint
CREATE INDEX `sdk_note_type_idx` ON `sdk_note` (`user_id`,`type`);--> statement-breakpoint
CREATE INDEX `sdk_note_embedding_idx` ON `sdk_note` (`embedding_id`);--> statement-breakpoint
CREATE INDEX `sdk_note_priority_idx` ON `sdk_note` (`user_id`,`priority`);--> statement-breakpoint
CREATE INDEX `sdk_note_archived_idx` ON `sdk_note` (`user_id`,`archived`);