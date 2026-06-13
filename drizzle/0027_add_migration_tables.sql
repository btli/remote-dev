-- Server-to-server project migration (stage 1: schema + peer registry +
-- DB-row transfer).
--
-- Adds the three migration tables: peer_instance (registry of remote Remote
-- Dev instances, API key encrypted at rest), migration_job (SOURCE-side state
-- machine), migration_import (DESTINATION-side import record whose `id` is the
-- source job id — correlation key, no uuid default). The SQLite path uses
-- `db:push` for fresh/dev databases; this hand-written migration mirrors the
-- 0013-0026 raw-SQL convention (the generated dialect source is
-- src/db/schema.sqlite.ts via `bun run db:codegen`) so existing SQLite
-- deployments can be upgraded in place. Tables are created in FK-dependency
-- order. Additive only — safe on populated databases.
CREATE TABLE `peer_instance` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`encrypted_api_key` text NOT NULL,
	`cf_access_client_id` text,
	`encrypted_cf_access_secret` text,
	`capabilities` text,
	`last_seen_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `peer_instance_user_idx` ON `peer_instance` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `peer_instance_user_name_unique` ON `peer_instance` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `migration_job` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`peer_instance_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`working_tree_mode` text DEFAULT 'full_tar' NOT NULL,
	`include_dot_env` integer DEFAULT true NOT NULL,
	`include_agent_creds` integer DEFAULT true NOT NULL,
	`include_ssh_keys` integer DEFAULT false NOT NULL,
	`include_agent_settings` integer DEFAULT true NOT NULL,
	`include_channel_history` integer DEFAULT false NOT NULL,
	`remove_source_after_verify` integer DEFAULT false NOT NULL,
	`size_estimate_bytes` integer,
	`bytes_transferred` integer DEFAULT 0 NOT NULL,
	`dest_project_id` text,
	`bundle_manifest_json` text,
	`conflict_report_json` text,
	`error_message` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`peer_instance_id`) REFERENCES `peer_instance`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `migration_job_user_idx` ON `migration_job` (`user_id`);--> statement-breakpoint
CREATE INDEX `migration_job_project_idx` ON `migration_job` (`project_id`);--> statement-breakpoint
CREATE INDEX `migration_job_user_status_idx` ON `migration_job` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `migration_import` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_instance_url` text NOT NULL,
	`status` text DEFAULT 'staged' NOT NULL,
	`staging_dir` text NOT NULL,
	`chunks_received` integer DEFAULT 0 NOT NULL,
	`total_chunks` integer,
	`imported_project_id` text,
	`manifest_json` text,
	`options_json` text DEFAULT '{}' NOT NULL,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `migration_import_status_idx` ON `migration_import` (`status`);--> statement-breakpoint
CREATE INDEX `migration_import_user_idx` ON `migration_import` (`user_id`);
