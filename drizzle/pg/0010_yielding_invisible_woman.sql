CREATE TABLE "claude_account" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"user_id" text NOT NULL,
	"account_kind" text DEFAULT 'subscription' NOT NULL,
	"credential_mode" text,
	"email_address" text,
	"organization_name" text,
	"rate_limit_tier" text,
	"api_key_prefix" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "claude_account_profile_id_unique" UNIQUE("profile_id")
);
--> statement-breakpoint
CREATE TABLE "claude_profile_pool_member" (
	"id" text PRIMARY KEY NOT NULL,
	"pool_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claude_profile_pool" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claude_usage_limit_state" (
	"profile_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"limit_status" text DEFAULT 'unknown' NOT NULL,
	"window_5h_pct" integer,
	"window_7d_pct" integer,
	"reset_at_5h" timestamp with time zone,
	"reset_at_7d" timestamp with time zone,
	"effective_reset_at" timestamp with time zone,
	"detection_source" text,
	"last_checked_at" timestamp with time zone,
	"last_polled_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "profile_id" text;--> statement-breakpoint
ALTER TABLE "agent_schedule" ADD COLUMN "profile_id" text;--> statement-breakpoint
ALTER TABLE "node_preferences" ADD COLUMN "claude_profile_pool_id" text;--> statement-breakpoint
ALTER TABLE "node_preferences" ADD COLUMN "claude_auto_relaunch_mode" text;--> statement-breakpoint
ALTER TABLE "project_profile_link" ADD COLUMN "pool_id" text;--> statement-breakpoint
ALTER TABLE "trigger_config" ADD COLUMN "profile_id" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "claude_auto_relaunch_mode" text DEFAULT 'notify' NOT NULL;--> statement-breakpoint
ALTER TABLE "claude_account" ADD CONSTRAINT "claude_account_profile_id_agent_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."agent_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_account" ADD CONSTRAINT "claude_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_profile_pool_member" ADD CONSTRAINT "claude_profile_pool_member_pool_id_claude_profile_pool_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."claude_profile_pool"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_profile_pool_member" ADD CONSTRAINT "claude_profile_pool_member_profile_id_agent_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."agent_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_profile_pool" ADD CONSTRAINT "claude_profile_pool_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_usage_limit_state" ADD CONSTRAINT "claude_usage_limit_state_profile_id_agent_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."agent_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_usage_limit_state" ADD CONSTRAINT "claude_usage_limit_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claude_account_profile_idx" ON "claude_account" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "claude_account_user_idx" ON "claude_account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claude_pool_member_pool_profile_unique" ON "claude_profile_pool_member" USING btree ("pool_id","profile_id");--> statement-breakpoint
CREATE INDEX "claude_pool_member_pool_priority_idx" ON "claude_profile_pool_member" USING btree ("pool_id","priority");--> statement-breakpoint
CREATE INDEX "claude_pool_member_profile_idx" ON "claude_profile_pool_member" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "claude_profile_pool_user_idx" ON "claude_profile_pool" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "claude_usage_limit_user_status_idx" ON "claude_usage_limit_state" USING btree ("user_id","limit_status");--> statement-breakpoint
CREATE INDEX "claude_usage_limit_user_idx" ON "claude_usage_limit_state" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_profile_id_agent_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."agent_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_schedule" ADD CONSTRAINT "agent_schedule_profile_id_agent_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."agent_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_profile_link" ADD CONSTRAINT "project_profile_link_pool_id_claude_profile_pool_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."claude_profile_pool"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_config" ADD CONSTRAINT "trigger_config_profile_id_agent_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."agent_profile"("id") ON DELETE set null ON UPDATE no action;