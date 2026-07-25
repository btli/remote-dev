CREATE TABLE "schedule_template" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"schedule_type" text NOT NULL,
	"cron_expression" text,
	"interval_seconds" integer,
	"timezone" text DEFAULT 'America/Los_Angeles' NOT NULL,
	"max_retries" integer DEFAULT 0 NOT NULL,
	"retry_delay_seconds" integer DEFAULT 60 NOT NULL,
	"timeout_seconds" integer DEFAULT 300 NOT NULL,
	"commands_json" text NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_schedule" ADD COLUMN "interval_seconds" integer;--> statement-breakpoint
ALTER TABLE "session_schedule" ADD COLUMN "anchor_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "schedule_template" ADD CONSTRAINT "schedule_template_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedule_template_user_idx" ON "schedule_template" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "schedule_template_usage_idx" ON "schedule_template" USING btree ("user_id","usage_count");