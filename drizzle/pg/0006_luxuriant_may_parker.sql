CREATE TABLE "webhook_delivery" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"event_kind" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "webhook_delivery_received_idx" ON "webhook_delivery" USING btree ("received_at");