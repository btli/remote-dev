CREATE TABLE `orchestrator_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`orchestrator_id` text NOT NULL,
	`action_type` text NOT NULL,
	`target_session_id` text,
	`details_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`orchestrator_id`) REFERENCES `orchestrator_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_session_id`) REFERENCES `terminal_session`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `orchestrator_audit_orchestrator_idx` ON `orchestrator_audit_log` (`orchestrator_id`);--> statement-breakpoint
CREATE INDEX `orchestrator_audit_time_idx` ON `orchestrator_audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `orchestrator_audit_action_idx` ON `orchestrator_audit_log` (`action_type`);--> statement-breakpoint
CREATE INDEX `orchestrator_audit_target_idx` ON `orchestrator_audit_log` (`target_session_id`);--> statement-breakpoint
CREATE TABLE `orchestrator_insight` (
	`id` text PRIMARY KEY NOT NULL,
	`orchestrator_id` text NOT NULL,
	`session_id` text,
	`type` text NOT NULL,
	`severity` text NOT NULL,
	`message` text NOT NULL,
	`context_json` text,
	`suggested_actions` text,
	`resolved` integer DEFAULT false NOT NULL,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`orchestrator_id`) REFERENCES `orchestrator_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `terminal_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `orchestrator_insight_orchestrator_idx` ON `orchestrator_insight` (`orchestrator_id`);--> statement-breakpoint
CREATE INDEX `orchestrator_insight_session_idx` ON `orchestrator_insight` (`session_id`);--> statement-breakpoint
CREATE INDEX `orchestrator_insight_resolved_idx` ON `orchestrator_insight` (`resolved`);--> statement-breakpoint
CREATE INDEX `orchestrator_insight_severity_idx` ON `orchestrator_insight` (`severity`);--> statement-breakpoint
CREATE INDEX `orchestrator_insight_type_severity_idx` ON `orchestrator_insight` (`type`,`severity`);--> statement-breakpoint
CREATE TABLE `orchestrator_session` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`scope_type` text,
	`scope_id` text,
	`custom_instructions` text,
	`monitoring_interval` integer DEFAULT 30 NOT NULL,
	`stall_threshold` integer DEFAULT 300 NOT NULL,
	`auto_intervention` integer DEFAULT false NOT NULL,
	`last_activity_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `terminal_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orchestrator_session_session_id_unique` ON `orchestrator_session` (`session_id`);--> statement-breakpoint
CREATE INDEX `orchestrator_session_user_idx` ON `orchestrator_session` (`user_id`);--> statement-breakpoint
CREATE INDEX `orchestrator_session_scope_idx` ON `orchestrator_session` (`scope_type`,`scope_id`);--> statement-breakpoint
CREATE INDEX `orchestrator_session_status_idx` ON `orchestrator_session` (`status`);--> statement-breakpoint
CREATE INDEX `orchestrator_session_type_idx` ON `orchestrator_session` (`type`);--> statement-breakpoint
ALTER TABLE `terminal_session` ADD `is_orchestrator_session` integer DEFAULT false NOT NULL;