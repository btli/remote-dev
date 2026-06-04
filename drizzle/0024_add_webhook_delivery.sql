-- [oyej.14] GitHub webhook delivery-id replay dedupe.
--
-- Adds the `webhook_delivery` ledger: an atomic insert-or-conflict on the
-- `X-GitHub-Delivery` UUID (the PRIMARY KEY) lets the webhook layer process
-- each delivery at most once. This covers issue/label events (head_sha == null)
-- that the per-(trigger_config, head_sha) `agent_run` unique index cannot dedupe
-- on redelivery. Additive only — safe on populated databases.
--
-- The SQLite path uses `db:push` for fresh/dev databases; this hand-written
-- migration mirrors the 0013-0023 raw-SQL convention (the generated dialect
-- source is src/db/schema.sqlite.ts via `bun run db:codegen`) so existing
-- SQLite deployments can be upgraded in place.
CREATE TABLE `webhook_delivery` (
	`delivery_id` text PRIMARY KEY NOT NULL,
	`event_kind` text NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `webhook_delivery_received_idx` ON `webhook_delivery` (`received_at`);
