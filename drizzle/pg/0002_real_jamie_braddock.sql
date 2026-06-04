CREATE TABLE "notification_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"push_by_type" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"muted_session_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quiet_hours_start" integer,
	"quiet_hours_end" integer,
	"min_push_severity" text DEFAULT 'actionable' NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_event" ADD COLUMN "severity" text DEFAULT 'passive' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_event" ADD COLUMN "coalesce_key" text;--> statement-breakpoint
ALTER TABLE "notification_event" ADD COLUMN "count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_event" ADD COLUMN "meta" jsonb;--> statement-breakpoint
-- [y5ch.1] updated_at is NOT NULL but its default is JS-side ($defaultFn, like
-- created_at). Adding a bare NOT NULL column to a populated table errors. We must
-- avoid a non-constant (volatile) default like now(): under Postgres that forces
-- a FULL TABLE REWRITE of notification_event under AccessExclusiveLock (deploy
-- outage). Instead add with a CONSTANT default (no rewrite — PG fast-paths a
-- constant fill), backfill from created_at, then drop the default so future
-- inserts go through the app's $defaultFn — mirroring the SQLite 0019 pattern.
ALTER TABLE "notification_event" ADD COLUMN "updated_at" timestamp with time zone DEFAULT '1970-01-01 00:00:00+00' NOT NULL;--> statement-breakpoint
UPDATE "notification_event" SET "updated_at" = "created_at";--> statement-breakpoint
ALTER TABLE "notification_event" ALTER COLUMN "updated_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_event_coalesce_idx" ON "notification_event" USING btree ("user_id","session_id","coalesce_key","read_at");