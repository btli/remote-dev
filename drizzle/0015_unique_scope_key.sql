-- F7: Enforce (user_id, terminal_type, scope_key) uniqueness for scope-keyed
-- sessions so concurrent creates can't both pass the SELECT + INSERT race and
-- end up with duplicate rows. Partial index on scope_key IS NOT NULL keeps
-- the constraint targeted — sessions without a scope key are untouched.
DROP INDEX IF EXISTS `terminal_session_scope_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `terminal_session_scope_unique_idx`
  ON `terminal_session` (`user_id`, `terminal_type`, `scope_key`)
  WHERE `scope_key` IS NOT NULL;
