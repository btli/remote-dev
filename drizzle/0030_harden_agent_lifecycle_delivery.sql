ALTER TABLE `terminal_session` ADD `agent_exit_notification_at` integer;--> statement-breakpoint
ALTER TABLE `terminal_session` ADD `agent_activity_order` integer;--> statement-breakpoint
ALTER TABLE `notification_delivery` ADD `notification_id` text REFERENCES `notification_event`(`id`) ON DELETE set null;--> statement-breakpoint
CREATE TABLE `agent_status_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`generation` integer NOT NULL,
	`delivery_id` text NOT NULL,
	`status` text NOT NULL,
	`source` text,
	`status_at` integer NOT NULL,
	`arrival_order` integer NOT NULL,
	`applied` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `terminal_session`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `agent_status_delivery_created_idx` ON `agent_status_delivery` (`created_at`);--> statement-breakpoint
CREATE INDEX `agent_status_delivery_session_idx` ON `agent_status_delivery` (`session_id`,`generation`);
