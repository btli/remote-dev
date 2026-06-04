CREATE TABLE "agent_run" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"schedule_id" text,
	"trigger_config_id" text,
	"source" text NOT NULL,
	"agent_provider" text NOT NULL,
	"agent_flags" text DEFAULT '[]' NOT NULL,
	"prompt" text NOT NULL,
	"session_id" text,
	"head_sha" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"agent_provider" text DEFAULT 'claude' NOT NULL,
	"agent_flags" text DEFAULT '[]' NOT NULL,
	"prompt" text NOT NULL,
	"worktree_type" text,
	"base_branch" text,
	"schedule_type" text DEFAULT 'recurring' NOT NULL,
	"cron_expression" text,
	"scheduled_at" timestamp with time zone,
	"timezone" text DEFAULT 'America/Los_Angeles' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"max_retries" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crown_candidate" (
	"id" text PRIMARY KEY NOT NULL,
	"crown_run_id" text NOT NULL,
	"run_id" text,
	"branch" text NOT NULL,
	"worktree_path" text,
	"diff" text,
	"diff_stats" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crown_run" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"prompt" text NOT NULL,
	"agent_provider" text DEFAULT 'claude' NOT NULL,
	"candidate_count" integer NOT NULL,
	"judge_model" text,
	"base_branch" text,
	"status" text DEFAULT 'running' NOT NULL,
	"winner_candidate_id" text,
	"crown_reason" text,
	"pr_url" text,
	"error_message" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trigger_config" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"github_repo_id" text,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"filter" text DEFAULT '{}' NOT NULL,
	"agent_provider" text DEFAULT 'claude' NOT NULL,
	"agent_flags" text DEFAULT '[]' NOT NULL,
	"prompt_template" text NOT NULL,
	"worktree_type" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trigger_event" (
	"id" text PRIMARY KEY NOT NULL,
	"trigger_config_id" text NOT NULL,
	"event_kind" text NOT NULL,
	"action" text,
	"head_sha" text,
	"matched" boolean DEFAULT false NOT NULL,
	"run_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_schedule_id_agent_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."agent_schedule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_trigger_config_id_trigger_config_id_fk" FOREIGN KEY ("trigger_config_id") REFERENCES "public"."trigger_config"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_session_id_terminal_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."terminal_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_schedule" ADD CONSTRAINT "agent_schedule_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_schedule" ADD CONSTRAINT "agent_schedule_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crown_candidate" ADD CONSTRAINT "crown_candidate_crown_run_id_crown_run_id_fk" FOREIGN KEY ("crown_run_id") REFERENCES "public"."crown_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crown_candidate" ADD CONSTRAINT "crown_candidate_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crown_run" ADD CONSTRAINT "crown_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crown_run" ADD CONSTRAINT "crown_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_config" ADD CONSTRAINT "trigger_config_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_config" ADD CONSTRAINT "trigger_config_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_config" ADD CONSTRAINT "trigger_config_github_repo_id_github_repository_id_fk" FOREIGN KEY ("github_repo_id") REFERENCES "public"."github_repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_event" ADD CONSTRAINT "trigger_event_trigger_config_id_trigger_config_id_fk" FOREIGN KEY ("trigger_config_id") REFERENCES "public"."trigger_config"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_event" ADD CONSTRAINT "trigger_event_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_run_user_idx" ON "agent_run" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_run_schedule_idx" ON "agent_run" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "agent_run_trigger_idx" ON "agent_run" USING btree ("trigger_config_id");--> statement-breakpoint
CREATE INDEX "agent_run_status_idx" ON "agent_run" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_run_trigger_head_idx" ON "agent_run" USING btree ("trigger_config_id","head_sha");--> statement-breakpoint
CREATE INDEX "agent_schedule_user_idx" ON "agent_schedule" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_schedule_next_run_idx" ON "agent_schedule" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "crown_candidate_run_idx" ON "crown_candidate" USING btree ("crown_run_id");--> statement-breakpoint
CREATE INDEX "crown_run_user_idx" ON "crown_run" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trigger_config_user_idx" ON "trigger_config" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trigger_config_repo_idx" ON "trigger_config" USING btree ("github_repo_id");--> statement-breakpoint
CREATE INDEX "trigger_event_config_idx" ON "trigger_event" USING btree ("trigger_config_id");