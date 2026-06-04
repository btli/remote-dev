-- [y5ch] Notifications signal-vs-noise overhaul (epic remote-dev-y5ch).
--
-- SQLite path uses `db:push` for fresh/dev databases; this hand-written
-- migration mirrors the 0014-0018 raw-SQL convention so existing SQLite
-- deployments can be upgraded in place without data loss.
--
-- SQLite cannot ADD a NOT NULL column without a constant DEFAULT. `severity`
-- and `count` carry SQL defaults already. `updated_at`'s real default is the
-- app's $defaultFn (like created_at); we add it with a constant epoch default
-- (0) purely so the ADD COLUMN succeeds against existing rows — every insert
-- from the application supplies the value, so the constant is only ever a
-- backfill for pre-existing rows, which we then align to created_at below.
ALTER TABLE `notification_event` ADD `severity` text DEFAULT 'passive' NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_event` ADD `coalesce_key` text;--> statement-breakpoint
ALTER TABLE `notification_event` ADD `count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_event` ADD `meta` text;--> statement-breakpoint
ALTER TABLE `notification_event` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Backfill: align updated_at with created_at for rows that predate the column.
UPDATE `notification_event` SET `updated_at` = `created_at` WHERE `updated_at` = 0;--> statement-breakpoint
CREATE INDEX `notification_event_coalesce_idx` ON `notification_event` (`user_id`,`session_id`,`coalesce_key`,`read_at`);--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`push_by_type` text DEFAULT '{}' NOT NULL,
	`muted_session_ids` text DEFAULT '[]' NOT NULL,
	`quiet_hours_start` integer,
	`quiet_hours_end` integer,
	`min_push_severity` text DEFAULT 'actionable' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
