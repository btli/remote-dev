ALTER TABLE "agent_schedule" ADD COLUMN "interval_seconds" integer;--> statement-breakpoint
ALTER TABLE "agent_schedule" ADD COLUMN "anchor_at" timestamp with time zone;