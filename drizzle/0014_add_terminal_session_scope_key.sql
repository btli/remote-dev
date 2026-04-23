ALTER TABLE `terminal_session` ADD `scope_key` text;--> statement-breakpoint
CREATE INDEX `terminal_session_scope_idx` ON `terminal_session` (`user_id`,`terminal_type`,`scope_key`);
