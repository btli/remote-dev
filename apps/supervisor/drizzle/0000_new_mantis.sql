CREATE TABLE IF NOT EXISTS `account` (
	`userId` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`providerAccountId` text NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` integer,
	`token_type` text,
	`scope` text,
	`id_token` text,
	`session_state` text,
	PRIMARY KEY(`provider`, `providerAccountId`),
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `account_user_idx` ON `account` (`userId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `instance` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`display_name` text NOT NULL,
	`owner_id` text NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`error_message` text,
	`namespace` text NOT NULL,
	`image_tag` text,
	`base_url` text,
	`storage_target_id` text,
	`storage_config_snapshot` text,
	`cpu_request` text,
	`cpu_limit` text,
	`mem_request` text,
	`mem_limit` text,
	`storage_request` text,
	`last_reconciled_at` integer,
	`provisioned_at` integer,
	`suspended_at` integer,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `supervisor_user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `instance_slug_unique` ON `instance` (`slug`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `instance_owner_idx` ON `instance` (`owner_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `instance_status_idx` ON `instance` (`status`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `instance_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`actor_id` text,
	`actor_email` text,
	`action` text NOT NULL,
	`previous_status` text,
	`new_status` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`instance_id`) REFERENCES `instance`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `instance_audit_log_instance_idx` ON `instance_audit_log` (`instance_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `instance_seed` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`authorized_emails` text,
	`job_dispatched` integer DEFAULT false NOT NULL,
	`job_name` text,
	`completed_at` integer,
	FOREIGN KEY (`instance_id`) REFERENCES `instance`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `instance_seed_instance_id_unique` ON `instance_seed` (`instance_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `registered_storage_target` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`config` text NOT NULL,
	`resiliency_note` text,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `registered_storage_target_name_unique` ON `registered_storage_target` (`name`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `session` (
	`sessionToken` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `supervisor_user` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `supervisor_user_email_unique` ON `supervisor_user` (`email`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text,
	`emailVerified` integer,
	`image` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `verificationToken` (
	`identifier` text NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL,
	PRIMARY KEY(`identifier`, `token`)
);
