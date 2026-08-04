ALTER TABLE `agent_status_delivery` ADD `notification_required` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_status_delivery` ADD `notification_processed_at` integer;--> statement-breakpoint
CREATE INDEX `agent_status_delivery_notification_idx` ON `agent_status_delivery` (`applied`,`notification_required`,`notification_processed_at`,`created_at`);
