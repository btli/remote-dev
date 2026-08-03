ALTER TABLE "claude_account" ADD COLUMN "usage_oauth_access_encrypted" text;--> statement-breakpoint
ALTER TABLE "claude_account" ADD COLUMN "usage_oauth_refresh_encrypted" text;--> statement-breakpoint
ALTER TABLE "claude_account" ADD COLUMN "usage_oauth_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claude_account" ADD COLUMN "usage_oauth_scopes" text;