#!/usr/bin/env bun
/**
 * CLI entry for the SQLite Claude-account pre-sync (remote-dev-n4x4.6).
 *
 * Runs on the main-app deploy from `scripts/deploy.ts`, immediately BEFORE
 * `bun run db:push` (and `db:backfill-claude-accounts` runs after it). It is a
 * complete no-op once the migration has been applied — see
 * `src/db/presync-claude-accounts.ts` for the gate and for what it backs up
 * before clearing.
 *
 * Run manually with: bun run db:presync-claude-accounts
 */
import { createClient } from "@libsql/client";
import { presyncClaudeAccounts } from "../src/db/presync-claude-accounts";
import { getDatabasePath } from "../src/lib/paths";

const dbPath = getDatabasePath();

presyncClaudeAccounts(createClient({ url: `file:${dbPath}` }), dbPath)
  .then((result) => {
    if (!result.pending) {
      console.log(
        "✅ claude account pre-sync: already migrated — nothing to do."
      );
    } else {
      console.log(
        `✅ claude account pre-sync: ${result.columnsAdded} column(s) added, ` +
          `${result.columnsAlreadyPresent} already present, ` +
          `${result.indexesDropped} index(es) dropped, ` +
          `${result.rowsCleared} re-keyed row(s) cleared` +
          (result.backupPath ? ` (backed up to ${result.backupPath})` : "") +
          ". Now run `bun run db:push`."
      );
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ claude_account pre-sync failed:", error);
    process.exit(1);
  });
