CREATE TABLE `sdk_extension_prompt` (
	`id` text PRIMARY KEY NOT NULL,
	`extension_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`template` text NOT NULL,
	`variables_json` text DEFAULT '[]' NOT NULL,
	`category` text,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`usage_count` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`extension_id`) REFERENCES `sdk_extension`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sdk_extension_prompt_ext_idx` ON `sdk_extension_prompt` (`extension_id`);--> statement-breakpoint
CREATE INDEX `sdk_extension_prompt_user_idx` ON `sdk_extension_prompt` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sdk_extension_prompt_name_idx` ON `sdk_extension_prompt` (`extension_id`,`name`);--> statement-breakpoint
CREATE INDEX `sdk_extension_prompt_category_idx` ON `sdk_extension_prompt` (`user_id`,`category`);--> statement-breakpoint
CREATE TABLE `sdk_extension_tool` (
	`id` text PRIMARY KEY NOT NULL,
	`extension_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`input_schema_json` text NOT NULL,
	`output_schema_json` text,
	`permissions_json` text DEFAULT '[]' NOT NULL,
	`examples_json` text DEFAULT '[]' NOT NULL,
	`is_dangerous` integer DEFAULT false NOT NULL,
	`timeout_ms` integer,
	`execution_count` integer DEFAULT 0 NOT NULL,
	`last_executed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`extension_id`) REFERENCES `sdk_extension`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sdk_extension_tool_ext_idx` ON `sdk_extension_tool` (`extension_id`);--> statement-breakpoint
CREATE INDEX `sdk_extension_tool_user_idx` ON `sdk_extension_tool` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sdk_extension_tool_name_idx` ON `sdk_extension_tool` (`extension_id`,`name`);--> statement-breakpoint
CREATE TABLE `sdk_extension` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`description` text,
	`author` text,
	`license` text,
	`repository` text,
	`type` text NOT NULL,
	`remote_dev_version` text NOT NULL,
	`main_path` text NOT NULL,
	`state` text DEFAULT 'unloaded' NOT NULL,
	`error` text,
	`permissions_json` text DEFAULT '[]' NOT NULL,
	`config_schema_json` text,
	`config_values_json` text DEFAULT '{}' NOT NULL,
	`dependencies_json` text DEFAULT '{}' NOT NULL,
	`loaded_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sdk_extension_user_idx` ON `sdk_extension` (`user_id`);--> statement-breakpoint
CREATE INDEX `sdk_extension_type_idx` ON `sdk_extension` (`user_id`,`type`);--> statement-breakpoint
CREATE INDEX `sdk_extension_state_idx` ON `sdk_extension` (`user_id`,`state`);--> statement-breakpoint
CREATE TABLE `sdk_memory_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text,
	`folder_id` text,
	`tier` text NOT NULL,
	`content_type` text NOT NULL,
	`name` text,
	`description` text,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	`embedding_id` text,
	`task_id` text,
	`priority` integer DEFAULT 0,
	`confidence` real DEFAULT 0.5,
	`relevance` real DEFAULT 0.5,
	`ttl_seconds` integer,
	`access_count` integer DEFAULT 0 NOT NULL,
	`last_accessed_at` integer NOT NULL,
	`source_sessions_json` text,
	`metadata_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `terminal_session`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`folder_id`) REFERENCES `session_folder`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `sdk_memory_user_tier_idx` ON `sdk_memory_entry` (`user_id`,`tier`);--> statement-breakpoint
CREATE INDEX `sdk_memory_folder_tier_idx` ON `sdk_memory_entry` (`folder_id`,`tier`);--> statement-breakpoint
CREATE INDEX `sdk_memory_session_idx` ON `sdk_memory_entry` (`session_id`);--> statement-breakpoint
CREATE INDEX `sdk_memory_task_idx` ON `sdk_memory_entry` (`task_id`);--> statement-breakpoint
CREATE INDEX `sdk_memory_content_type_idx` ON `sdk_memory_entry` (`user_id`,`content_type`);--> statement-breakpoint
CREATE INDEX `sdk_memory_expires_idx` ON `sdk_memory_entry` (`expires_at`);--> statement-breakpoint
CREATE INDEX `sdk_memory_hash_idx` ON `sdk_memory_entry` (`content_hash`);--> statement-breakpoint
CREATE INDEX `sdk_memory_relevance_idx` ON `sdk_memory_entry` (`user_id`,`tier`,`relevance`);--> statement-breakpoint
CREATE TABLE `sdk_meta_agent_benchmark_result` (
	`id` text PRIMARY KEY NOT NULL,
	`benchmark_id` text NOT NULL,
	`config_id` text NOT NULL,
	`user_id` text NOT NULL,
	`score` real NOT NULL,
	`passed` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`test_results_json` text NOT NULL,
	`errors_json` text DEFAULT '[]' NOT NULL,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`files_modified_json` text DEFAULT '[]' NOT NULL,
	`commands_executed_json` text DEFAULT '[]' NOT NULL,
	`raw_output` text,
	`executed_at` integer NOT NULL,
	FOREIGN KEY (`benchmark_id`) REFERENCES `sdk_meta_agent_benchmark`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`config_id`) REFERENCES `sdk_meta_agent_config`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sdk_benchmark_result_benchmark_idx` ON `sdk_meta_agent_benchmark_result` (`benchmark_id`);--> statement-breakpoint
CREATE INDEX `sdk_benchmark_result_config_idx` ON `sdk_meta_agent_benchmark_result` (`config_id`);--> statement-breakpoint
CREATE INDEX `sdk_benchmark_result_user_idx` ON `sdk_meta_agent_benchmark_result` (`user_id`);--> statement-breakpoint
CREATE INDEX `sdk_benchmark_result_score_idx` ON `sdk_meta_agent_benchmark_result` (`benchmark_id`,`score`);--> statement-breakpoint
CREATE TABLE `sdk_meta_agent_benchmark` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`task_spec_json` text NOT NULL,
	`test_cases_json` text NOT NULL,
	`success_criteria_json` text NOT NULL,
	`timeout_seconds` integer DEFAULT 300 NOT NULL,
	`run_count` integer DEFAULT 0 NOT NULL,
	`last_run_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sdk_meta_agent_benchmark_user_idx` ON `sdk_meta_agent_benchmark` (`user_id`);--> statement-breakpoint
CREATE TABLE `sdk_meta_agent_config` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`folder_id` text,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`task_spec_json` text NOT NULL,
	`project_context_json` text NOT NULL,
	`system_prompt` text NOT NULL,
	`instructions_file` text NOT NULL,
	`mcp_config_json` text,
	`tool_config_json` text,
	`memory_config_json` text,
	`metadata_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `session_folder`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `sdk_meta_agent_config_user_idx` ON `sdk_meta_agent_config` (`user_id`);--> statement-breakpoint
CREATE INDEX `sdk_meta_agent_config_folder_idx` ON `sdk_meta_agent_config` (`folder_id`);--> statement-breakpoint
CREATE INDEX `sdk_meta_agent_config_provider_idx` ON `sdk_meta_agent_config` (`user_id`,`provider`);--> statement-breakpoint
CREATE TABLE `sdk_note` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text,
	`folder_id` text,
	`content` text NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`embedding_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `terminal_session`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`folder_id`) REFERENCES `session_folder`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `sdk_note_user_idx` ON `sdk_note` (`user_id`);--> statement-breakpoint
CREATE INDEX `sdk_note_session_idx` ON `sdk_note` (`session_id`);--> statement-breakpoint
CREATE INDEX `sdk_note_folder_idx` ON `sdk_note` (`folder_id`);--> statement-breakpoint
ALTER TABLE `session_folder` ADD `path` text;