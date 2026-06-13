CREATE TABLE "migration_import" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source_instance_url" text NOT NULL,
	"status" text DEFAULT 'staged' NOT NULL,
	"staging_dir" text NOT NULL,
	"chunks_received" integer DEFAULT 0 NOT NULL,
	"total_chunks" integer,
	"imported_project_id" text,
	"manifest_json" text,
	"options_json" text DEFAULT '{}' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "migration_job" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"peer_instance_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"working_tree_mode" text DEFAULT 'full_tar' NOT NULL,
	"include_dot_env" boolean DEFAULT true NOT NULL,
	"include_agent_creds" boolean DEFAULT true NOT NULL,
	"include_ssh_keys" boolean DEFAULT false NOT NULL,
	"include_agent_settings" boolean DEFAULT true NOT NULL,
	"include_channel_history" boolean DEFAULT false NOT NULL,
	"remove_source_after_verify" boolean DEFAULT false NOT NULL,
	"size_estimate_bytes" integer,
	"bytes_transferred" integer DEFAULT 0 NOT NULL,
	"dest_project_id" text,
	"bundle_manifest_json" text,
	"conflict_report_json" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "peer_instance" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"cf_access_client_id" text,
	"encrypted_cf_access_secret" text,
	"capabilities" text,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "migration_import" ADD CONSTRAINT "migration_import_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_job" ADD CONSTRAINT "migration_job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_job" ADD CONSTRAINT "migration_job_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_job" ADD CONSTRAINT "migration_job_peer_instance_id_peer_instance_id_fk" FOREIGN KEY ("peer_instance_id") REFERENCES "public"."peer_instance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_instance" ADD CONSTRAINT "peer_instance_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "migration_import_status_idx" ON "migration_import" USING btree ("status");--> statement-breakpoint
CREATE INDEX "migration_import_user_idx" ON "migration_import" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "migration_job_user_idx" ON "migration_job" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "migration_job_project_idx" ON "migration_job" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "migration_job_user_status_idx" ON "migration_job" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "peer_instance_user_idx" ON "peer_instance" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "peer_instance_user_name_unique" ON "peer_instance" USING btree ("user_id","name");