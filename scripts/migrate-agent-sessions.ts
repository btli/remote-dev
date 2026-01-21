#!/usr/bin/env bun
/**
 * Migration script: Convert existing feature sessions to agent terminal type
 *
 * NOTE: This migration is a no-op because the original implementation did not
 * persist startupCommand or featureDescription to the database. These values
 * were only used transiently during session creation.
 *
 * New sessions created after this update will correctly use terminalType="agent"
 * when created through the Feature Session wizard.
 *
 * Run with: bun run scripts/migrate-agent-sessions.ts
 *
 * Options:
 *   --dry-run   Show what would be changed without making changes
 *   --verbose   Show detailed output
 */

import { db } from "../src/db";
import { terminalSessions } from "../src/db/schema";
import { eq, sql } from "drizzle-orm";

// MigrationResult interface - kept for documentation purposes
// Originally planned to track migration changes but no longer needed
// since startupCommand/featureDescription were not persisted to DB

async function migrateAgentSessions(options: { dryRun?: boolean; verbose?: boolean }) {
  const { dryRun = false, verbose = false } = options;

  console.log("🔍 Checking for sessions that need migration...\n");

  // Count total sessions
  const totalResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(terminalSessions);
  const totalSessions = totalResult[0]?.count ?? 0;

  // Count sessions by terminal type
  const typeStats = await db
    .select({
      terminalType: terminalSessions.terminalType,
      count: sql<number>`count(*)`
    })
    .from(terminalSessions)
    .groupBy(terminalSessions.terminalType);

  console.log(`📊 Session Statistics:`);
  console.log(`   Total sessions: ${totalSessions}`);
  for (const stat of typeStats) {
    console.log(`   - ${stat.terminalType ?? "null"}: ${stat.count}`);
  }
  console.log();

  // Check for sessions with terminalType = null (shouldn't happen but let's check)
  const nullTypeSessions = await db
    .select()
    .from(terminalSessions)
    .where(sql`${terminalSessions.terminalType} IS NULL`);

  if (nullTypeSessions.length > 0) {
    console.log(`⚠️  Found ${nullTypeSessions.length} session(s) with NULL terminalType.`);
    console.log(`   These will be set to 'shell' (the default).\n`);

    if (!dryRun) {
      for (const session of nullTypeSessions) {
        await db
          .update(terminalSessions)
          .set({ terminalType: "shell" })
          .where(eq(terminalSessions.id, session.id));

        if (verbose) {
          console.log(`   ✅ Updated ${session.name} to 'shell'`);
        }
      }
      console.log(`   ✅ Fixed ${nullTypeSessions.length} session(s).\n`);
    } else {
      console.log(`   🔸 DRY RUN - Would fix ${nullTypeSessions.length} session(s).\n`);
    }
  }

  // No automatic migration can be done for historical sessions because:
  // 1. startupCommand was not persisted to database
  // 2. featureDescription was not persisted to database
  // 3. We cannot determine which sessions were originally "agent" sessions
  console.log("ℹ️  No automatic migration available for historical sessions.");
  console.log("   The original schema did not persist startupCommand or featureDescription.");
  console.log("   New sessions created via Feature Session wizard will use terminalType='agent'.");
  console.log();

  console.log("✅ Migration check complete!\n");
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const verbose = args.includes("--verbose");

if (dryRun) {
  console.log("🔸 Running in DRY RUN mode - no changes will be made.\n");
}

migrateAgentSessions({ dryRun, verbose })
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });
