#!/usr/bin/env bun
/**
 * Migration script: Add [credential] section to existing profile .gitconfig files.
 *
 * Existing agent profiles have .gitconfig files with only [user] section.
 * This script adds the [credential] section that configures `gh` as the
 * git credential helper, suppressing macOS Keychain credential prompts.
 *
 * The credential section format:
 *   [credential]
 *       helper =                              # Clear inherited chain (e.g., osxkeychain)
 *       helper = !/path/to/gh auth git-credential  # Set gh as the only helper
 *
 * Run with: bun run scripts/migrate-profile-gitconfigs.ts
 *
 * Options:
 *   --dry-run   Show what would be changed without making changes
 */

import { db } from "../src/db";
import { agentProfiles } from "../src/db/schema";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { execFile as execFileCb } from "child_process";
import { promisify } from "util";

const execFile = promisify(execFileCb);
const dryRun = process.argv.includes("--dry-run");

async function resolveGhPath(): Promise<string> {
  try {
    const { stdout } = await execFile("which", ["gh"]);
    const resolved = stdout.trim();
    if (resolved) return resolved;
  } catch {
    // gh not installed
  }
  return "gh";
}

function buildCredentialSection(ghPath: string): string {
  return [
    "[credential]",
    "\thelper =",
    `\thelper = !${ghPath} auth git-credential`,
    "",
  ].join("\n");
}

async function main() {
  console.log("🔄 Adding [credential] section to existing profile .gitconfig files...\n");
  if (dryRun) console.log("  (dry run mode - no changes will be made)\n");

  // Resolve gh binary path once
  const ghPath = await resolveGhPath();
  console.log(`  gh binary path: ${ghPath}\n`);

  const credentialSection = buildCredentialSection(ghPath);

  // Find all profiles
  const profiles = await db.query.agentProfiles.findMany();
  console.log(`  Found ${profiles.length} agent profile(s)\n`);

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const profile of profiles) {
    const gitconfigPath = join(profile.configDir, ".gitconfig");

    // Read existing gitconfig
    let existingContent: string;
    try {
      existingContent = await readFile(gitconfigPath, "utf-8");
    } catch {
      console.log(`  ✗ ${profile.name} (${profile.id}) - .gitconfig not found (skipping)`);
      failed++;
      continue;
    }

    // Check idempotency: skip if [credential] section already present
    if (existingContent.includes("[credential]")) {
      console.log(`  ✓ ${profile.name} (${profile.id}) - already has [credential] (skipping)`);
      skipped++;
      continue;
    }

    if (!dryRun) {
      // Append credential section to existing gitconfig
      const newContent = existingContent.trimEnd() + "\n" + credentialSection;
      await writeFile(gitconfigPath, newContent, { mode: 0o600 });
    }

    console.log(`  ${dryRun ? "Would migrate" : "✓ Migrated"} ${profile.name} (${profile.id})`);
    migrated++;
  }

  console.log(`\n📊 Results:`);
  console.log(`  Migrated: ${migrated}`);
  console.log(`  Skipped (already done): ${skipped}`);
  console.log(`  Failed: ${failed}`);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
