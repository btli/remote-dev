#!/usr/bin/env bun
/**
 * Migration Script: Orchestrator Feature Flag Rollout
 *
 * This script handles the migration for the orchestrator-first mode feature flag.
 * It can be used to:
 * 1. Pause all orchestrators (when rolling out with feature flag OFF by default)
 * 2. Resume orchestrators for users who have enabled the feature flag
 * 3. Report on orchestrator state across all users
 *
 * Usage:
 *   bun run scripts/migrate-orchestrators.ts [command]
 *
 * Commands:
 *   report   - Show current state of all orchestrators and their feature flag status
 *   pause    - Pause all orchestrators (safe for rollout with flag OFF)
 *   resume   - Resume orchestrators where feature flag is enabled
 *   help     - Show this help message
 */

import { db } from "@/db";
import { orchestratorSessions, userSettings, folderPreferences, users } from "@/db/schema";
import { eq, and, or } from "drizzle-orm";

interface OrchestratorReport {
  id: string;
  userId: string;
  userEmail: string | null;
  type: string;
  status: string;
  scopeId: string | null;
  userOrchestratorMode: boolean;
  folderOrchestratorMode: boolean | null;
  effectiveMode: boolean;
}

async function generateReport(): Promise<OrchestratorReport[]> {
  console.log("\n=== Orchestrator Feature Flag Migration Report ===\n");

  // Get all orchestrators with their user info
  const orchestrators = await db
    .select({
      id: orchestratorSessions.id,
      userId: orchestratorSessions.userId,
      type: orchestratorSessions.type,
      status: orchestratorSessions.status,
      scopeId: orchestratorSessions.scopeId,
    })
    .from(orchestratorSessions);

  if (orchestrators.length === 0) {
    console.log("No orchestrators found in the database.");
    return [];
  }

  const reports: OrchestratorReport[] = [];

  for (const orch of orchestrators) {
    // Get user info
    const userResult = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, orch.userId))
      .limit(1);

    // Get user settings
    const settingsResult = await db
      .select({ orchestratorFirstMode: userSettings.orchestratorFirstMode })
      .from(userSettings)
      .where(eq(userSettings.userId, orch.userId))
      .limit(1);

    // Get folder preferences if scoped
    let folderMode: boolean | null = null;
    if (orch.scopeId) {
      const folderResult = await db
        .select({ orchestratorFirstMode: folderPreferences.orchestratorFirstMode })
        .from(folderPreferences)
        .where(
          and(
            eq(folderPreferences.folderId, orch.scopeId),
            eq(folderPreferences.userId, orch.userId)
          )
        )
        .limit(1);
      folderMode = folderResult[0]?.orchestratorFirstMode ?? null;
    }

    const userMode = settingsResult[0]?.orchestratorFirstMode ?? false;
    const effectiveMode = folderMode !== null ? folderMode : userMode;

    reports.push({
      id: orch.id,
      userId: orch.userId,
      userEmail: userResult[0]?.email ?? null,
      type: orch.type,
      status: orch.status,
      scopeId: orch.scopeId,
      userOrchestratorMode: userMode,
      folderOrchestratorMode: folderMode,
      effectiveMode,
    });
  }

  // Print report
  console.log("Orchestrator ID                       | Type             | Status     | User                        | Mode");
  console.log("-".repeat(120));

  for (const report of reports) {
    const modeStr = report.effectiveMode ? "ENABLED" : "disabled";
    const modeSource = report.folderOrchestratorMode !== null ? "(folder)" : "(user)";
    console.log(
      `${report.id.slice(0, 36).padEnd(38)} | ${report.type.padEnd(16)} | ${report.status.padEnd(10)} | ${(report.userEmail ?? report.userId.slice(0, 24)).padEnd(27)} | ${modeStr} ${modeSource}`
    );
  }

  // Summary
  const enabledCount = reports.filter((r) => r.effectiveMode).length;
  const disabledCount = reports.filter((r) => !r.effectiveMode).length;
  const activeCount = reports.filter((r) => r.status !== "paused").length;
  const pausedCount = reports.filter((r) => r.status === "paused").length;

  console.log("\n=== Summary ===");
  console.log(`Total orchestrators: ${reports.length}`);
  console.log(`  - Feature flag ENABLED: ${enabledCount}`);
  console.log(`  - Feature flag disabled: ${disabledCount}`);
  console.log(`  - Status active (idle/analyzing/acting): ${activeCount}`);
  console.log(`  - Status paused: ${pausedCount}`);

  return reports;
}

async function pauseAllOrchestrators(): Promise<void> {
  console.log("\n=== Pausing All Orchestrators ===\n");

  const result = await db
    .update(orchestratorSessions)
    .set({
      status: "paused",
      updatedAt: new Date(),
    })
    .where(
      or(
        eq(orchestratorSessions.status, "idle"),
        eq(orchestratorSessions.status, "analyzing"),
        eq(orchestratorSessions.status, "acting")
      )
    )
    .returning({ id: orchestratorSessions.id });

  console.log(`Paused ${result.length} orchestrator(s).`);
  console.log("\nOrchestrators are now paused. They will not run until:");
  console.log("1. User enables orchestratorFirstMode in their settings");
  console.log("2. Server restarts (monitoring service will check feature flag)");
  console.log("3. Or you run: bun run scripts/migrate-orchestrators.ts resume");
}

async function resumeEnabledOrchestrators(): Promise<void> {
  console.log("\n=== Resuming Orchestrators with Feature Flag Enabled ===\n");

  // Get all paused orchestrators
  const pausedOrchestrators = await db
    .select()
    .from(orchestratorSessions)
    .where(eq(orchestratorSessions.status, "paused"));

  let resumedCount = 0;
  let skippedCount = 0;

  for (const orch of pausedOrchestrators) {
    // Check if feature flag is enabled
    const settingsResult = await db
      .select({ orchestratorFirstMode: userSettings.orchestratorFirstMode })
      .from(userSettings)
      .where(eq(userSettings.userId, orch.userId))
      .limit(1);

    const userEnabled = settingsResult[0]?.orchestratorFirstMode ?? false;

    // Check folder preferences if scoped
    let effectiveEnabled = userEnabled;
    if (orch.scopeId) {
      const folderResult = await db
        .select({ orchestratorFirstMode: folderPreferences.orchestratorFirstMode })
        .from(folderPreferences)
        .where(
          and(
            eq(folderPreferences.folderId, orch.scopeId),
            eq(folderPreferences.userId, orch.userId)
          )
        )
        .limit(1);

      const folderEnabled = folderResult[0]?.orchestratorFirstMode;
      if (folderEnabled !== null && folderEnabled !== undefined) {
        effectiveEnabled = folderEnabled;
      }
    }

    if (effectiveEnabled) {
      await db
        .update(orchestratorSessions)
        .set({
          status: "idle",
          updatedAt: new Date(),
        })
        .where(eq(orchestratorSessions.id, orch.id));

      console.log(`Resumed: ${orch.id} (${orch.type})`);
      resumedCount++;
    } else {
      console.log(`Skipped: ${orch.id} (feature flag disabled)`);
      skippedCount++;
    }
  }

  console.log(`\nResumed ${resumedCount} orchestrator(s), skipped ${skippedCount} (feature flag disabled).`);
  console.log("\nNote: Restart the terminal server to begin monitoring.");
}

function showHelp(): void {
  console.log(`
Orchestrator Feature Flag Migration Script

This script helps manage the orchestrator-first mode feature flag rollout.

Usage:
  bun run scripts/migrate-orchestrators.ts [command]

Commands:
  report   Show current state of all orchestrators and their feature flag status
  pause    Pause all orchestrators (safe for rollout with flag OFF by default)
  resume   Resume orchestrators for users who have enabled the feature flag
  help     Show this help message

Rollout Process:
  1. Run 'pause' to safely pause all existing orchestrators
  2. Deploy with ORCHESTRATOR_FIRST_MODE feature flag (default OFF)
  3. Users can enable the feature flag in their settings
  4. Run 'resume' to resume orchestrators for enabled users
  5. Or simply restart the server - monitoring service respects feature flag

Examples:
  bun run scripts/migrate-orchestrators.ts report
  bun run scripts/migrate-orchestrators.ts pause
  bun run scripts/migrate-orchestrators.ts resume
`);
}

// Main entry point
async function main(): Promise<void> {
  const command = process.argv[2] || "help";

  switch (command) {
    case "report":
      await generateReport();
      break;
    case "pause":
      await pauseAllOrchestrators();
      break;
    case "resume":
      await resumeEnabledOrchestrators();
      break;
    case "help":
    default:
      showHelp();
      break;
  }
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
