CREATE TABLE `ssh_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`host` text NOT NULL,
	`port` integer DEFAULT 22 NOT NULL,
	`username` text NOT NULL,
	`auth_type` text NOT NULL,
	`has_passphrase` integer DEFAULT false NOT NULL,
	`password_enc` text,
	`known_hosts_policy` text DEFAULT 'accept-new' NOT NULL,
	`extra_options` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ssh_connection_user_project_idx` ON `ssh_connection` (`user_id`,`project_id`);
