CREATE TABLE "agent_work_context" (
	"session_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"branch" text,
	"worktree_path" text,
	"activity_status" text,
	"claimed_issue_id" text,
	"claimed_issue_title" text,
	"join_confidence" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"session_id" text NOT NULL,
	"mode" text DEFAULT 'auto_deliver' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"to_session_id" text NOT NULL,
	"project_id" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"channel_kind" text,
	"delivered_at" timestamp with time zone,
	"acked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_replay_cursor" (
	"session_id" text PRIMARY KEY NOT NULL,
	"last_acked_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_work_context" ADD CONSTRAINT "agent_work_context_session_id_terminal_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."terminal_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_subscription" ADD CONSTRAINT "channel_subscription_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_subscription" ADD CONSTRAINT "channel_subscription_session_id_terminal_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."terminal_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_delivery" ADD CONSTRAINT "message_delivery_message_id_agent_peer_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."agent_peer_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_delivery" ADD CONSTRAINT "message_delivery_to_session_id_terminal_session_id_fk" FOREIGN KEY ("to_session_id") REFERENCES "public"."terminal_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_replay_cursor" ADD CONSTRAINT "message_replay_cursor_session_id_terminal_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."terminal_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_work_context_project_idx" ON "agent_work_context" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_subscription_unique_idx" ON "channel_subscription" USING btree ("channel_id","session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_delivery_msg_session_idx" ON "message_delivery" USING btree ("message_id","to_session_id");--> statement-breakpoint
CREATE INDEX "message_delivery_session_state_idx" ON "message_delivery" USING btree ("to_session_id","state","created_at");