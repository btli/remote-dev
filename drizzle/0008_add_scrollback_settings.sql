-- Add scrollback buffer settings to user_settings
ALTER TABLE `user_settings` ADD `xterm_scrollback` integer DEFAULT 10000;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `tmux_history_limit` integer DEFAULT 50000;
