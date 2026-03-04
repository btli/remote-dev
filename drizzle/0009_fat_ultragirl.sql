CREATE TABLE `project_task` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`folder_id` text,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'open' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`labels` text DEFAULT '[]' NOT NULL,
	`subtasks` text DEFAULT '[]' NOT NULL,
	`due_date` integer,
	`github_issue_url` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `session_folder`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_task_user_idx` ON `project_task` (`user_id`);--> statement-breakpoint
CREATE INDEX `project_task_folder_idx` ON `project_task` (`folder_id`);--> statement-breakpoint
CREATE INDEX `project_task_user_folder_idx` ON `project_task` (`user_id`,`folder_id`);--> statement-breakpoint
ALTER TABLE `folder_preferences` ADD `pinned_files` text;