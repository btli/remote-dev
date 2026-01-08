-- Add unique constraints to prevent duplicate orchestrators (race condition protection)
-- This migration adds:
-- 1. A partial unique index on user_id for master orchestrators only
-- 2. A unique index on (user_id, scope_id) for sub-orchestrators

-- Ensure only one master orchestrator per user
-- Uses a partial index to only apply to type='master' rows
-- This allows multiple sub_orchestrators per user while preventing duplicate masters
CREATE UNIQUE INDEX `orchestrator_session_master_unique` ON `orchestrator_session` (`user_id`) WHERE `type` = 'master';

-- Ensure only one sub-orchestrator per folder per user
-- For sub-orchestrators, scope_id is the folder_id (not null)
-- For masters, scope_id is null - SQLite treats null as distinct, so this doesn't affect masters
CREATE UNIQUE INDEX `orchestrator_session_scope_unique` ON `orchestrator_session` (`user_id`, `scope_id`) WHERE `scope_id` IS NOT NULL;
