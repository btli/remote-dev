CREATE TABLE "account" (
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "account_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "instance" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"owner_id" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"error_message" text,
	"namespace" text NOT NULL,
	"image_tag" text,
	"base_url" text,
	"storage_target_id" text,
	"storage_config_snapshot" text,
	"cpu_request" text,
	"cpu_limit" text,
	"mem_request" text,
	"mem_limit" text,
	"storage_request" text,
	"last_reconciled_at" timestamp with time zone,
	"provisioned_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "instance_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "instance_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"actor_id" text,
	"actor_email" text,
	"action" text NOT NULL,
	"previous_status" text,
	"new_status" text,
	"metadata" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instance_seed" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"authorized_emails" text,
	"job_dispatched" boolean DEFAULT false NOT NULL,
	"job_name" text,
	"completed_at" timestamp with time zone,
	CONSTRAINT "instance_seed_instance_id_unique" UNIQUE("instance_id")
);
--> statement-breakpoint
CREATE TABLE "registered_storage_target" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"config" text NOT NULL,
	"resiliency_note" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "registered_storage_target_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supervisor_user" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "supervisor_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"emailVerified" timestamp with time zone,
	"image" text,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verificationToken" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verificationToken_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance" ADD CONSTRAINT "instance_owner_id_supervisor_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."supervisor_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance_audit_log" ADD CONSTRAINT "instance_audit_log_instance_id_instance_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance_seed" ADD CONSTRAINT "instance_seed_instance_id_instance_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "instance_owner_idx" ON "instance" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "instance_status_idx" ON "instance" USING btree ("status");--> statement-breakpoint
CREATE INDEX "instance_audit_log_instance_idx" ON "instance_audit_log" USING btree ("instance_id");