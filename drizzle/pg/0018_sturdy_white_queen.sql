CREATE TABLE "agent_status_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"generation" integer NOT NULL,
	"delivery_id" text NOT NULL,
	"status" text NOT NULL,
	"source" text,
	"status_at" bigint NOT NULL,
	"arrival_order" bigint NOT NULL,
	"applied" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"notification_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "terminal_session" ALTER COLUMN "agent_activity_status_at" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "terminal_session" ADD COLUMN "agent_exit_notification_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "terminal_session" ADD COLUMN "agent_activity_order" bigint;--> statement-breakpoint
ALTER TABLE "agent_status_delivery" ADD CONSTRAINT "agent_status_delivery_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_status_delivery" ADD CONSTRAINT "agent_status_delivery_session_id_terminal_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."terminal_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_notification_id_notification_event_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notification_event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_status_delivery_created_idx" ON "agent_status_delivery" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "agent_status_delivery_session_idx" ON "agent_status_delivery" USING btree ("session_id","generation");--> statement-breakpoint
CREATE INDEX "notification_delivery_created_idx" ON "notification_delivery" USING btree ("created_at");