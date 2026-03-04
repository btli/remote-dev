ALTER TABLE `folder_preferences` ADD `pinned_files` text;--> statement-breakpoint
ALTER TABLE `terminal_session` ADD `pinned` integer DEFAULT false NOT NULL;