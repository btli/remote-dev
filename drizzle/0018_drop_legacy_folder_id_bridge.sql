-- Drop the transitional `legacy_folder_id` bridge columns + their unique
-- indexes from `project_group` and `project`. The bridge was retained for
-- back-compat through the previous release; tracked by bd remote-dev-lylj.
DROP INDEX IF EXISTS `project_group_legacy_user_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `project_legacy_user_idx`;--> statement-breakpoint
ALTER TABLE `project_group` DROP COLUMN `legacy_folder_id`;--> statement-breakpoint
ALTER TABLE `project` DROP COLUMN `legacy_folder_id`;
