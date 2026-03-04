-- Add session_id to project_task for agent TodoWrite sync
-- Links agent-created tasks to the originating terminal session

ALTER TABLE `project_task` ADD `session_id` text REFERENCES terminal_session(id);--> statement-breakpoint
CREATE INDEX `project_task_session_idx` ON `project_task` (`session_id`);
