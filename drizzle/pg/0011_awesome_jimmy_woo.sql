ALTER TABLE "agent_run" DROP CONSTRAINT "agent_run_profile_id_agent_profile_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_schedule" DROP CONSTRAINT "agent_schedule_profile_id_agent_profile_id_fk";
--> statement-breakpoint
ALTER TABLE "project_profile_link" DROP CONSTRAINT "project_profile_link_pool_id_claude_profile_pool_id_fk";
--> statement-breakpoint
ALTER TABLE "trigger_config" DROP CONSTRAINT "trigger_config_profile_id_agent_profile_id_fk";
