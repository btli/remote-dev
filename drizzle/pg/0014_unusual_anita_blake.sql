-- [remote-dev-n4x4.6] Decouple claude_account from agent_profile.
--
-- HAND-EDITED after `drizzle-kit generate`: the generated DDL alone cannot run
-- on a populated database, because it (a) adds a NOT NULL `account_id` to
-- `claude_profile_pool_member` and (b) adds `account_id` as a PRIMARY KEY to
-- `claude_usage_limit_state`, which already has one on `profile_id`.
--
-- Both tables are cleared first, deliberately:
--   * `claude_usage_limit_state` holds ephemeral OBSERVATIONS that the reactive
--     detector / poller re-derive within one 5h window.
--   * `claude_profile_pool_member` held profile-keyed rows that have no
--     mechanical translation to accounts (a profile could map to zero or many);
--     pool MEMBERSHIP must be re-added once, now as accounts. The pools
--     themselves (`claude_profile_pool`) are preserved.
-- `claude_account` rows are NOT touched — `profile_id` is retained (nullable,
-- non-unique) as an origin breadcrumb. Run `bun run db:backfill-claude-accounts`
-- afterwards to create accounts for claude-capable profiles that had none.

DELETE FROM "claude_usage_limit_state";--> statement-breakpoint
DELETE FROM "claude_profile_pool_member";--> statement-breakpoint
ALTER TABLE "claude_usage_limit_state" DROP CONSTRAINT IF EXISTS "claude_usage_limit_state_pkey";--> statement-breakpoint
ALTER TABLE "claude_account" DROP CONSTRAINT "claude_account_profile_id_unique";--> statement-breakpoint
ALTER TABLE "claude_account" DROP CONSTRAINT "claude_account_profile_id_agent_profile_id_fk";
--> statement-breakpoint
ALTER TABLE "claude_profile_pool_member" DROP CONSTRAINT "claude_profile_pool_member_profile_id_agent_profile_id_fk";
--> statement-breakpoint
ALTER TABLE "claude_usage_limit_state" DROP CONSTRAINT "claude_usage_limit_state_profile_id_agent_profile_id_fk";
--> statement-breakpoint
DROP INDEX "claude_pool_member_pool_profile_unique";--> statement-breakpoint
DROP INDEX "claude_pool_member_profile_idx";--> statement-breakpoint
ALTER TABLE "claude_account" ALTER COLUMN "profile_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "claude_account" ADD COLUMN "alias" text;--> statement-breakpoint
ALTER TABLE "claude_account" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "claude_account" ADD COLUMN "auth_method" text;--> statement-breakpoint
ALTER TABLE "claude_account" ADD COLUMN "auth_healthy" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "claude_account" ADD COLUMN "last_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claude_account" ADD COLUMN "oauth_token_encrypted" text;--> statement-breakpoint
ALTER TABLE "claude_profile_pool_member" ADD COLUMN "account_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "claude_usage_limit_state" ADD COLUMN "account_id" text PRIMARY KEY NOT NULL;--> statement-breakpoint
ALTER TABLE "project_profile_link" ADD COLUMN "account_id" text;--> statement-breakpoint
ALTER TABLE "terminal_session" ADD COLUMN "claude_account_id" text;--> statement-breakpoint
ALTER TABLE "claude_account" ADD CONSTRAINT "claude_account_profile_id_agent_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."agent_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_profile_pool_member" ADD CONSTRAINT "claude_profile_pool_member_account_id_claude_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."claude_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_usage_limit_state" ADD CONSTRAINT "claude_usage_limit_state_account_id_claude_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."claude_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_session" ADD CONSTRAINT "terminal_session_claude_account_id_claude_account_id_fk" FOREIGN KEY ("claude_account_id") REFERENCES "public"."claude_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claude_account_user_email_idx" ON "claude_account" USING btree ("user_id","email_address");--> statement-breakpoint
CREATE UNIQUE INDEX "claude_pool_member_pool_account_unique" ON "claude_profile_pool_member" USING btree ("pool_id","account_id");--> statement-breakpoint
CREATE INDEX "claude_pool_member_account_idx" ON "claude_profile_pool_member" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "claude_account" DROP COLUMN "credential_mode";--> statement-breakpoint
ALTER TABLE "claude_profile_pool_member" DROP COLUMN "profile_id";--> statement-breakpoint
ALTER TABLE "claude_usage_limit_state" DROP COLUMN "profile_id";