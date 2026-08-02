CREATE TABLE "claude_usage_limit_window" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"limit_group" text,
	"percent" integer DEFAULT 0 NOT NULL,
	"severity" text,
	"resets_at" timestamp with time zone,
	"scope_model" text,
	"scope_surface" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claude_usage_limit_window" ADD CONSTRAINT "claude_usage_limit_window_account_id_claude_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."claude_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_usage_limit_window" ADD CONSTRAINT "claude_usage_limit_window_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claude_usage_limit_window_account_idx" ON "claude_usage_limit_window" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "claude_usage_limit_window_account_scope_idx" ON "claude_usage_limit_window" USING btree ("account_id","scope_model");--> statement-breakpoint
CREATE INDEX "claude_usage_limit_window_user_idx" ON "claude_usage_limit_window" USING btree ("user_id");