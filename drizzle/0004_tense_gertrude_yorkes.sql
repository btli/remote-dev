CREATE TABLE `split_group` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`direction` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `split_group_user_idx` ON `split_group` (`user_id`);--> statement-breakpoint
CREATE TABLE `trash_item` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`resource_name` text NOT NULL,
	`trashed_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trash_item_user_type_idx` ON `trash_item` (`user_id`,`resource_type`);--> statement-breakpoint
CREATE INDEX `trash_item_expires_idx` ON `trash_item` (`expires_at`);--> statement-breakpoint
CREATE INDEX `trash_item_resource_idx` ON `trash_item` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE TABLE `worktree_trash_metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`trash_item_id` text NOT NULL,
	`github_repo_id` text,
	`repo_name` text NOT NULL,
	`repo_local_path` text NOT NULL,
	`worktree_branch` text NOT NULL,
	`worktree_original_path` text NOT NULL,
	`worktree_trash_path` text NOT NULL,
	`original_folder_id` text,
	`original_folder_name` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`trash_item_id`) REFERENCES `trash_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`github_repo_id`) REFERENCES `github_repository`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `worktree_trash_metadata_trash_item_id_unique` ON `worktree_trash_metadata` (`trash_item_id`);--> statement-breakpoint
CREATE INDEX `worktree_trash_repo_idx` ON `worktree_trash_metadata` (`github_repo_id`);--> statement-breakpoint
ALTER TABLE `terminal_session` ADD `split_group_id` text REFERENCES split_group(id);--> statement-breakpoint
ALTER TABLE `terminal_session` ADD `split_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `terminal_session` ADD `split_size` real DEFAULT 0.5;--> statement-breakpoint
CREATE INDEX `terminal_session_split_group_idx` ON `terminal_session` (`split_group_id`);