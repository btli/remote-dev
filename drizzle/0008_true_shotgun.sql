ALTER TABLE `terminal_session` ADD `terminal_type` text DEFAULT 'shell';--> statement-breakpoint
ALTER TABLE `terminal_session` ADD `agent_exit_state` text;--> statement-breakpoint
ALTER TABLE `terminal_session` ADD `agent_exit_code` integer;--> statement-breakpoint
ALTER TABLE `terminal_session` ADD `agent_exited_at` integer;--> statement-breakpoint
ALTER TABLE `terminal_session` ADD `agent_restart_count` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `terminal_session` ADD `type_metadata` text;--> statement-breakpoint
CREATE INDEX `terminal_session_type_idx` ON `terminal_session` (`user_id`,`terminal_type`);