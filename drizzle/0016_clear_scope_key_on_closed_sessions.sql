-- F-hotfix: null out scope_key on sessions that are already closed or trashed.
-- Without this, the partial UNIQUE index on (user_id, terminal_type, scope_key)
-- blocks a fresh create-session even though scope-key dedup (which filters to
-- active/suspended rows) doesn't find the blocking row. Closing/trashing a
-- session now nulls scope_key at the same time; this migration retroactively
-- clears the slot for any row that was closed before that fix landed.
UPDATE `terminal_session`
SET `scope_key` = NULL
WHERE `scope_key` IS NOT NULL
  AND `status` IN ('closed', 'trashed');
