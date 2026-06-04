CREATE TABLE "model_proxy_token" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text,
	"instance_slug" text,
	"token_prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"provider_scope" text DEFAULT '["anthropic"]' NOT NULL,
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_usage_event" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text,
	"instance_slug" text,
	"provider" text NOT NULL,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_creation_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" integer,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_proxy_token" ADD CONSTRAINT "model_proxy_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_proxy_token" ADD CONSTRAINT "model_proxy_token_session_id_terminal_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."terminal_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_proxy_token_prefix_idx" ON "model_proxy_token" USING btree ("token_prefix");--> statement-breakpoint
CREATE INDEX "model_proxy_token_session_idx" ON "model_proxy_token" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "model_proxy_token_user_idx" ON "model_proxy_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "model_usage_session_idx" ON "model_usage_event" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "model_usage_user_idx" ON "model_usage_event" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "model_usage_instance_idx" ON "model_usage_event" USING btree ("instance_slug");--> statement-breakpoint
CREATE INDEX "model_usage_created_idx" ON "model_usage_event" USING btree ("created_at");