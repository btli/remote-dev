ALTER TABLE `folder_preferences` ADD `orchestrator_first_mode` integer;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `orchestrator_first_mode` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `master_control_directory` text;