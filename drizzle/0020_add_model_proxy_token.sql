-- [aehq] Centralized model-key proxy: scoped, revocable, per-session tokens
-- (`mp_…`) that authenticate calls to /api/model-proxy. Hash-at-rest, modeled
-- on `api_key`. Hand-written to match the SQLite migration convention (the
-- generated dialect file is src/db/schema.sqlite.ts via `bun run db:codegen`).
CREATE TABLE `model_proxy_token` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text,
	`instance_slug` text,
	`token_prefix` text NOT NULL,
	`token_hash` text NOT NULL,
	`provider_scope` text DEFAULT '["anthropic"]' NOT NULL,
	`revoked_at` integer,
	`expires_at` integer,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `terminal_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `model_proxy_token_prefix_idx` ON `model_proxy_token` (`token_prefix`);--> statement-breakpoint
CREATE INDEX `model_proxy_token_session_idx` ON `model_proxy_token` (`session_id`);--> statement-breakpoint
CREATE INDEX `model_proxy_token_user_idx` ON `model_proxy_token` (`user_id`);
