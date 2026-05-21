#!/usr/bin/env bun
/**
 * One-time migration: null out agent_provider on non-agent sessions.
 *
 * Prior to this fix, the Drizzle schema column `agent_provider` had a
 * `.default("claude")` clause, which caused every session row — including
 * shells, file viewers, browsers, SSH sessions, etc. — to be written with
 * `agent_provider = 'claude'`. That value is meaningless and misleading for
 * non-agent terminal types.
 *
 * This script clears `agent_provider` (sets it to NULL) for every row where
 * `terminal_type` is NOT 'agent' or 'loop'. Agent and loop sessions keep their
 * provider value as-is.
 *
 * The script is idempotent — running it a second time reports 0 updates
 * because no qualifying rows with a non-NULL provider remain.
 *
 * After this script runs, the schema default has already been removed from
 * schema.ts. New sessions will be written with NULL for non-agent types.
 */

import { db } from "../src/db";
import { terminalSessions } from "../src/db/schema";
import { notInArray, isNotNull, and, sql } from "drizzle-orm";

const AGENT_TERMINAL_TYPES = ["agent", "loop"] as const;

async function main() {
  console.log(
    "[migrate-agent-provider] Clearing stale agent_provider values on non-agent sessions\n"
  );

  // Count how many rows are affected before updating, for the summary.
  const candidates = await db.query.terminalSessions.findMany({
    where: and(
      notInArray(terminalSessions.terminalType, [...AGENT_TERMINAL_TYPES]),
      isNotNull(terminalSessions.agentProvider)
    ),
    columns: { id: true },
  });

  const count = candidates.length;

  if (count === 0) {
    console.log(
      "[migrate-agent-provider] No stale rows found — nothing to do (idempotent re-run or already clean).\n"
    );
    return;
  }

  // Perform the bulk update using raw SQL for clarity and atomicity.
  // Drizzle's `notInArray` on text columns with a typed literal array works
  // cleanly here but we use sql`` to avoid any type coercion edge cases with
  // the text-typed column and the enum values.
  await db
    .update(terminalSessions)
    .set({ agentProvider: null })
    .where(
      and(
        notInArray(terminalSessions.terminalType, [...AGENT_TERMINAL_TYPES]),
        isNotNull(terminalSessions.agentProvider)
      )
    );

  console.log(
    `[migrate-agent-provider] cleared ${count} stale agent_provider values on non-agent sessions\n`
  );
}

main()
  .then(() => {
    process.exit(process.exitCode ?? 0);
  })
  .catch((err) => {
    console.error("[migrate-agent-provider] Migration failed:", err);
    process.exit(1);
  });
