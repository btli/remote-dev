CREATE TABLE `project_metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_id` text NOT NULL,
	`user_id` text NOT NULL,
	`project_path` text NOT NULL,
	`enrichment_status` text DEFAULT 'pending' NOT NULL,
	`enriched_at` integer,
	`last_enrichment_error` text,
	`category` text DEFAULT 'unknown' NOT NULL,
	`primary_language` text,
	`languages` text DEFAULT '[]' NOT NULL,
	`framework` text,
	`is_monorepo` integer DEFAULT false NOT NULL,
	`has_typescript` integer DEFAULT false NOT NULL,
	`has_docker` integer DEFAULT false NOT NULL,
	`has_ci` integer DEFAULT false NOT NULL,
	`dependencies` text DEFAULT '[]' NOT NULL,
	`dev_dependencies` text DEFAULT '[]' NOT NULL,
	`dependency_count` integer DEFAULT 0 NOT NULL,
	`dev_dependency_count` integer DEFAULT 0 NOT NULL,
	`package_manager` text,
	`build_tool` text,
	`test_framework` text,
	`cicd` text,
	`git` text,
	`total_files` integer DEFAULT 0 NOT NULL,
	`source_files` integer DEFAULT 0 NOT NULL,
	`test_files` integer DEFAULT 0 NOT NULL,
	`config_files` integer DEFAULT 0 NOT NULL,
	`suggested_startup_commands` text DEFAULT '[]' NOT NULL,
	`suggested_agent_instructions` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `session_folder`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_metadata_folder_id_unique` ON `project_metadata` (`folder_id`);--> statement-breakpoint
CREATE INDEX `project_metadata_user_idx` ON `project_metadata` (`user_id`);--> statement-breakpoint
CREATE INDEX `project_metadata_status_idx` ON `project_metadata` (`enrichment_status`);--> statement-breakpoint
CREATE INDEX `project_metadata_user_status_idx` ON `project_metadata` (`user_id`,`enrichment_status`);--> statement-breakpoint
CREATE INDEX `project_metadata_path_idx` ON `project_metadata` (`project_path`);--> statement-breakpoint
CREATE INDEX `orchestrator_audit_orchestrator_time_idx` ON `orchestrator_audit_log` (`orchestrator_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `orchestrator_session_user_status_idx` ON `orchestrator_session` (`user_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `orchestrator_session_scope_unique` ON `orchestrator_session` (`user_id`,`scope_id`);