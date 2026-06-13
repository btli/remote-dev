-- Claude profile usage-limit management (cswap-style): per-profile usage-limit
-- state, Claude-specific account identity, and group-inherited fallback pools
-- with auto-rotation. Epic remote-dev-3b3l (Wave A / P1.1).
--
-- Adds four tables — claude_profile_pool (named fallback pool), claude_account
-- (Claude identity + account kind, 1:1 with agent_profile), claude_usage_limit_state
-- (authoritative per-profile limit store), claude_profile_pool_member (ordered
-- membership) — plus additive columns on existing tables (pool/profile pins +
-- auto-relaunch mode). The SQLite path uses `db:push` for fresh/dev databases;
-- this hand-written migration mirrors the 0013-0027 raw-SQL convention (the
-- generated dialect source is src/db/schema.sqlite.ts via `bun run db:codegen`)
-- so existing SQLite deployments can be upgraded in place.
--
-- NOTE: SQLite `ALTER TABLE ADD COLUMN` cannot attach a foreign-key clause, so
-- the new columns on agent_run / agent_schedule / trigger_config /
-- node_preferences / project_profile_link are added as plain columns here; the
-- FK relationships exist in schema.sqlite.ts and are enforced for fresh
-- `db:push` databases. Additive / nullable (or defaulted) only — safe on
-- populated databases. Tables are created in FK-dependency order.
CREATE TABLE `claude_profile_pool` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `claude_profile_pool_user_idx` ON `claude_profile_pool` (`user_id`);--> statement-breakpoint
CREATE TABLE `claude_account` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`user_id` text NOT NULL,
	`account_kind` text DEFAULT 'subscription' NOT NULL,
	`credential_mode` text,
	`email_address` text,
	`organization_name` text,
	`rate_limit_tier` text,
	`api_key_prefix` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `agent_profile`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `claude_account_profile_id_unique` ON `claude_account` (`profile_id`);--> statement-breakpoint
CREATE INDEX `claude_account_profile_idx` ON `claude_account` (`profile_id`);--> statement-breakpoint
CREATE INDEX `claude_account_user_idx` ON `claude_account` (`user_id`);--> statement-breakpoint
CREATE TABLE `claude_usage_limit_state` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`limit_status` text DEFAULT 'unknown' NOT NULL,
	`window_5h_pct` integer,
	`window_7d_pct` integer,
	`reset_at_5h` integer,
	`reset_at_7d` integer,
	`effective_reset_at` integer,
	`detection_source` text,
	`last_checked_at` integer,
	`last_polled_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `agent_profile`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `claude_usage_limit_user_status_idx` ON `claude_usage_limit_state` (`user_id`,`limit_status`);--> statement-breakpoint
CREATE INDEX `claude_usage_limit_user_idx` ON `claude_usage_limit_state` (`user_id`);--> statement-breakpoint
CREATE TABLE `claude_profile_pool_member` (
	`id` text PRIMARY KEY NOT NULL,
	`pool_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`pool_id`) REFERENCES `claude_profile_pool`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `agent_profile`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `claude_pool_member_pool_profile_unique` ON `claude_profile_pool_member` (`pool_id`,`profile_id`);--> statement-breakpoint
CREATE INDEX `claude_pool_member_pool_priority_idx` ON `claude_profile_pool_member` (`pool_id`,`priority`);--> statement-breakpoint
CREATE INDEX `claude_pool_member_profile_idx` ON `claude_profile_pool_member` (`profile_id`);--> statement-breakpoint
ALTER TABLE `user_settings` ADD `claude_auto_relaunch_mode` text DEFAULT 'notify' NOT NULL;--> statement-breakpoint
ALTER TABLE `node_preferences` ADD `claude_profile_pool_id` text;--> statement-breakpoint
ALTER TABLE `node_preferences` ADD `claude_auto_relaunch_mode` text;--> statement-breakpoint
ALTER TABLE `project_profile_link` ADD `pool_id` text;--> statement-breakpoint
ALTER TABLE `trigger_config` ADD `profile_id` text;--> statement-breakpoint
ALTER TABLE `agent_schedule` ADD `profile_id` text;--> statement-breakpoint
ALTER TABLE `agent_run` ADD `profile_id` text;
