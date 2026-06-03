CREATE TABLE "port_claim" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text,
	"port" integer NOT NULL,
	"variable_name" text NOT NULL,
	"is_listening" boolean,
	"pid" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "port_claim" ADD CONSTRAINT "port_claim_session_id_terminal_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."terminal_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "port_claim" ADD CONSTRAINT "port_claim_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "port_claim" ADD CONSTRAINT "port_claim_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "port_claim_session_idx" ON "port_claim" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "port_claim_user_idx" ON "port_claim" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "port_claim_port_idx" ON "port_claim" USING btree ("port");--> statement-breakpoint
CREATE UNIQUE INDEX "port_claim_session_port_unique" ON "port_claim" USING btree ("session_id","port");