-- [x386] Agent-native chat & coordination (epic remote-dev-x386).
--
-- SQLite path uses `db:push` for fresh/dev databases; this hand-written
-- migration mirrors the 0014-0022 raw-SQL convention so existing SQLite
-- deployments can be upgraded in place. Four new tables: message_delivery,
-- message_replay_cursor, channel_subscription, agent_work_context. All
-- referenced tables (agent_peer_message, terminal_session, channel) already
-- exist, so no ordering constraints beyond that. The generated dialect file is
-- src/db/schema.sqlite.ts via `bun run db:codegen`; the Postgres equivalent is
-- drizzle/pg/0005_misty_red_ghost.sql.
CREATE TABLE `message_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`to_session_id` text NOT NULL,
	`project_id` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`channel_kind` text,
	`delivered_at` integer,
	`acked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `agent_peer_message`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_session_id`) REFERENCES `terminal_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_delivery_msg_session_idx` ON `message_delivery` (`message_id`,`to_session_id`);--> statement-breakpoint
CREATE INDEX `message_delivery_session_state_idx` ON `message_delivery` (`to_session_id`,`state`,`created_at`);--> statement-breakpoint
CREATE TABLE `message_replay_cursor` (
	`session_id` text PRIMARY KEY NOT NULL,
	`last_acked_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `terminal_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `channel_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`session_id` text NOT NULL,
	`mode` text DEFAULT 'auto_deliver' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channel`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `terminal_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_subscription_unique_idx` ON `channel_subscription` (`channel_id`,`session_id`);--> statement-breakpoint
CREATE TABLE `agent_work_context` (
	`session_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`branch` text,
	`worktree_path` text,
	`activity_status` text,
	`claimed_issue_id` text,
	`claimed_issue_title` text,
	`join_confidence` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `terminal_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_work_context_project_idx` ON `agent_work_context` (`project_id`);
