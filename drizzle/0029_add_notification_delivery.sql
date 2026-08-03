-- Deduplicate retried hook deliveries independently from visible notification
-- rows, allowing distinct lifecycle events to retain normal coalescing.
CREATE TABLE `notification_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `notification_delivery_created_idx` ON `notification_delivery` (`created_at`);
