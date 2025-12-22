DROP INDEX `folder_preferences_folder_id_unique`;--> statement-breakpoint
DROP INDEX `folder_prefs_folder_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `folder_prefs_folder_user_idx` ON `folder_preferences` (`folder_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `account` (`userId`);