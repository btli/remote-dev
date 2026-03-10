#!/usr/bin/env bun
/**
 * Migration script: Backfill github_account_metadata from existing OAuth accounts.
 *
 * For users who already have a GitHub OAuth account linked via the `account` table,
 * this script creates the corresponding `github_account_metadata` entry with:
 * - login/avatar fetched from GitHub API using the stored token
 * - isDefault = true (since they only have one account)
 * - configDir pointing to ~/.remote-dev/gh-configs/{providerAccountId}/
 *
 * It also provisions the gh CLI config (hosts.yml) for each account.
 *
 * Run with: bun run scripts/migrate-github-accounts.ts
 *
 * Options:
 *   --dry-run   Show what would be changed without making changes
 */

import { db } from "../src/db";
import { accounts, githubAccountMetadata } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { decryptSafe } from "../src/lib/encryption";
import { getGhConfigsDir } from "../src/lib/paths";
import { join } from "path";
import { mkdir, writeFile, chmod } from "fs/promises";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(`🔄 Backfilling github_account_metadata from existing OAuth accounts...\n`);
  if (dryRun) console.log("  (dry run mode - no changes will be made)\n");

  // Find all GitHub OAuth accounts
  const githubOAuthAccounts = await db.query.accounts.findMany({
    where: eq(accounts.provider, "github"),
  });

  console.log(`  Found ${githubOAuthAccounts.length} GitHub OAuth account(s)\n`);

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const oauthAccount of githubOAuthAccounts) {
    const { userId, providerAccountId, access_token } = oauthAccount;

    // Check if metadata already exists
    const existing = await db.query.githubAccountMetadata.findFirst({
      where: eq(githubAccountMetadata.providerAccountId, providerAccountId),
    });

    if (existing) {
      console.log(`  ✓ ${providerAccountId} - already migrated (skipping)`);
      skipped++;
      continue;
    }

    // Decrypt token
    const token = access_token ? decryptSafe(access_token) : null;
    if (!token) {
      console.log(`  ✗ ${providerAccountId} - no valid token (skipping)`);
      failed++;
      continue;
    }

    // Fetch user info from GitHub API
    let login: string;
    let displayName: string | null = null;
    let avatarUrl: string;
    let email: string | null = null;

    try {
      const res = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (!res.ok) {
        console.log(`  ✗ ${providerAccountId} - GitHub API error ${res.status} (skipping)`);
        failed++;
        continue;
      }

      const user = await res.json();
      login = user.login;
      displayName = user.name ?? null;
      avatarUrl = user.avatar_url;
      email = user.email ?? null;
    } catch (err) {
      console.log(`  ✗ ${providerAccountId} - fetch failed: ${err}`);
      failed++;
      continue;
    }

    const configDir = join(getGhConfigsDir(), providerAccountId);

    if (!dryRun) {
      // Create metadata entry
      const now = new Date();
      await db.insert(githubAccountMetadata).values({
        providerAccountId,
        userId,
        login,
        displayName,
        avatarUrl,
        email,
        isDefault: true,
        configDir,
        createdAt: now,
        updatedAt: now,
      });

      // Provision gh CLI config
      await mkdir(configDir, { recursive: true });
      const hostsContent = `github.com:\n    oauth_token: ${token}\n    user: ${login}\n    git_protocol: https\n`;
      const hostsPath = join(configDir, "hosts.yml");
      await writeFile(hostsPath, hostsContent, { mode: 0o600 });
      await chmod(configDir, 0o700);
    }

    console.log(`  ${dryRun ? "Would migrate" : "✓ Migrated"} ${providerAccountId} (@${login})`);
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
