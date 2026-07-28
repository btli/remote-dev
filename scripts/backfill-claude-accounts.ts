#!/usr/bin/env bun
/**
 * CLI entry for the Claude account backfill (remote-dev-n4x4.6).
 *
 * Run AFTER `bun run db:push` applies the profile→account decoupling. Creates a
 * standalone `claude_account` row for every claude-capable profile that lacks
 * one and links project primaries to their account. Idempotent — safe to run on
 * every deploy. See `src/db/backfill-claude-accounts.ts` for the logic and for
 * what is deliberately NOT backfilled.
 *
 * Run manually with: bun run db:backfill-claude-accounts
 */
import { backfillClaudeAccounts } from "../src/db/backfill-claude-accounts";

backfillClaudeAccounts()
  .then((result) => {
    console.log(
      `✅ claude_account backfill: ${result.accountsCreated} created, ` +
        `${result.accountsAlreadyPresent} already present ` +
        `(${result.profilesScanned} claude-capable profiles scanned), ` +
        `${result.projectLinksLinked} project link(s) linked`
    );
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ claude_account backfill failed:", error);
    process.exit(1);
  });
