-- Multi GitHub Accounts support
-- Adds metadata table for GitHub accounts and folder-to-account binding

CREATE TABLE IF NOT EXISTS `github_account_metadata` (
  `provider_account_id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
  `login` text NOT NULL,
  `display_name` text,
  `avatar_url` text NOT NULL,
  `email` text,
  `is_default` integer DEFAULT false NOT NULL,
  `config_dir` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE INDEX IF NOT EXISTS `github_account_metadata_user_idx` ON `github_account_metadata` (`user_id`);

CREATE TABLE IF NOT EXISTS `folder_github_account_link` (
  `folder_id` text PRIMARY KEY NOT NULL REFERENCES `session_folder`(`id`) ON DELETE CASCADE,
  `provider_account_id` text NOT NULL,
  `created_at` integer NOT NULL
);

CREATE INDEX IF NOT EXISTS `folder_gh_account_link_account_idx` ON `folder_github_account_link` (`provider_account_id`);
