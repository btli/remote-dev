// @vitest-environment node

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import * as sqliteSchema from "@/db/schema.sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDir = mkdtempSync(join(tmpdir(), "rdv-agent-status-delivery-"));
const rawClient = createClient({ url: `file:${join(testDir, "status.db")}` });
const testDb = drizzle(rawClient, { schema: sqliteSchema });

vi.mock("@/db", () => ({ db: testDb }));

async function createSchema() {
  await rawClient.execute(`CREATE TABLE IF NOT EXISTS terminal_session (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    agent_restart_count integer DEFAULT 0,
    agent_exit_state text,
    agent_activity_status text,
    agent_activity_status_at integer,
    agent_activity_order integer
  )`);
  await rawClient.execute(`CREATE TABLE IF NOT EXISTS agent_status_delivery (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    session_id text NOT NULL,
    generation integer NOT NULL,
    delivery_id text NOT NULL,
    status text NOT NULL,
    source text,
    status_at integer NOT NULL,
    arrival_order integer NOT NULL,
    applied integer DEFAULT 0 NOT NULL,
    created_at integer NOT NULL
  )`);
}

beforeEach(async () => {
  await createSchema();
  await rawClient.execute("DELETE FROM agent_status_delivery");
  await rawClient.execute("DELETE FROM terminal_session");
  await rawClient.execute({
    sql: `INSERT INTO terminal_session
      (id, user_id, agent_restart_count, agent_exit_state, agent_activity_status)
      VALUES (?, ?, 0, 'running', 'running')`,
    args: ["s1", "u1"],
  });
});

afterAll(() => {
  rawClient.close();
  rmSync(testDir, { recursive: true, force: true });
});

describe("applyAgentStatusDelivery", () => {
  it("uses immutable arrival order when requests complete authentication out of order", async () => {
    const { applyAgentStatusDelivery } = await import("../agent-status-delivery");

    const newer = await applyAgentStatusDelivery({
      sessionId: "s1",
      userId: "u1",
      generation: 0,
      deliveryId: "newer",
      status: "running",
      source: null,
      statusAt: 2_000,
      arrivalOrder: 2_000_000,
    });
    const older = await applyAgentStatusDelivery({
      sessionId: "s1",
      userId: "u1",
      generation: 0,
      deliveryId: "older",
      status: "waiting",
      source: null,
      statusAt: 1_000,
      arrivalOrder: 1_000_000,
    });

    expect(newer.disposition).toBe("apply");
    expect(older.disposition).toBe("ignore");
    const row = await rawClient.execute({
      sql: "SELECT agent_activity_status, agent_activity_status_at FROM terminal_session WHERE id = ?",
      args: ["s1"],
    });
    expect(row.rows[0]).toMatchObject({
      agent_activity_status: "running",
      agent_activity_status_at: 2_000,
    });
  });

  it("deduplicates an exact retry without rewriting or resurrecting stale attention", async () => {
    const { applyAgentStatusDelivery } = await import("../agent-status-delivery");
    const waiting = {
      sessionId: "s1",
      userId: "u1",
      generation: 0,
      deliveryId: "wait-1",
      status: "waiting",
      source: null,
      statusAt: 1_000,
      arrivalOrder: 1_000_000,
    } as const;

    expect((await applyAgentStatusDelivery(waiting)).disposition).toBe("apply");
    expect((await applyAgentStatusDelivery({
      ...waiting,
      deliveryId: "run-1",
      status: "running",
      statusAt: 2_000,
      arrivalOrder: 2_000_000,
    })).disposition).toBe("apply");

    const retry = await applyAgentStatusDelivery({
      ...waiting,
      statusAt: 3_000,
      arrivalOrder: 3_000_000,
    });
    expect(retry).toMatchObject({ disposition: "retry", applied: true, isCurrent: false });

    const row = await rawClient.execute({
      sql: "SELECT agent_activity_status, agent_activity_status_at FROM terminal_session WHERE id = ?",
      args: ["s1"],
    });
    expect(row.rows[0]).toMatchObject({
      agent_activity_status: "running",
      agent_activity_status_at: 2_000,
    });
  });

  it("keeps the first accepted semantic status when a fallback retries the same delivery id", async () => {
    const { applyAgentStatusDelivery } = await import("../agent-status-delivery");

    const accepted = await applyAgentStatusDelivery({
      sessionId: "s1",
      userId: "u1",
      generation: 0,
      deliveryId: "commit-then-503",
      status: "waiting",
      source: null,
      statusAt: 1_000,
      arrivalOrder: 1_000_000,
    });
    const fallback = await applyAgentStatusDelivery({
      sessionId: "s1",
      userId: "u1",
      generation: 0,
      deliveryId: "commit-then-503",
      status: "running",
      source: null,
      statusAt: 2_000,
      arrivalOrder: 2_000_000,
    });

    expect(accepted).toMatchObject({
      disposition: "apply",
      isCurrent: true,
      status: "waiting",
      source: null,
    });
    expect(fallback).toMatchObject({
      disposition: "retry",
      isCurrent: true,
      status: "waiting",
      source: null,
    });
    const receipts = await rawClient.execute({
      sql: "SELECT status, applied FROM agent_status_delivery WHERE delivery_id = ?",
      args: ["commit-then-503"],
    });
    expect(receipts.rows).toEqual([{ status: "waiting", applied: 1 }]);
    const session = await rawClient.execute(
      "SELECT agent_activity_status, agent_activity_status_at FROM terminal_session WHERE id = 's1'",
    );
    expect(session.rows[0]).toMatchObject({
      agent_activity_status: "waiting",
      agent_activity_status_at: 1_000,
    });
  });
});
