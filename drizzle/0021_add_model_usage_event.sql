-- [aehq] Centralized model-key proxy: per-call token/cost usage events for
-- observability + central billing (attributed by session / user / instance).
-- Hand-written to match the SQLite migration convention (the generated dialect
-- file is src/db/schema.sqlite.ts via `bun run db:codegen`).
CREATE TABLE `model_usage_event` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text,
	`instance_slug` text,
	`provider` text NOT NULL,
	`model` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_creation_tokens` integer DEFAULT 0 NOT NULL,
	`cost_micro_usd` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `model_usage_session_idx` ON `model_usage_event` (`session_id`);--> statement-breakpoint
CREATE INDEX `model_usage_user_idx` ON `model_usage_event` (`user_id`);--> statement-breakpoint
CREATE INDEX `model_usage_instance_idx` ON `model_usage_event` (`instance_slug`);--> statement-breakpoint
CREATE INDEX `model_usage_created_idx` ON `model_usage_event` (`created_at`);
