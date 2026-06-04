// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createClient, type Client } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/db/schema";

// Real in-memory libsql (cost math + group-by aggregation IS the SQL).
let client: Client;
let testDb: ReturnType<typeof drizzle<typeof schema>>;

vi.mock("@/db", () => ({
  get db() {
    return testDb;
  },
}));

const CREATE_TABLE = `
  CREATE TABLE model_usage_event (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    session_id TEXT,
    instance_slug TEXT,
    provider TEXT NOT NULL,
    model TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    cost_micro_usd INTEGER,
    created_at INTEGER NOT NULL
  );
`;

async function resetDb(): Promise<void> {
  client = createClient({ url: ":memory:" });
  testDb = drizzle(client, { schema });
  await client.execute(CREATE_TABLE);
}

import { recordUsage, usageByScope, computeCostMicroUsd } from "./model-usage-service";
import type { ProxyPrincipal } from "./model-proxy-token-service";
import type { MeteredUsage } from "@/lib/model-proxy/sse-meter";

const principal: ProxyPrincipal = {
  userId: "user-1",
  sessionId: "session-1",
  instanceSlug: "alpha",
  tokenId: "tok-1",
};

function usage(over: Partial<MeteredUsage> = {}): MeteredUsage {
  return {
    model: "claude-sonnet-4-5",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    ...over,
  };
}

describe("ModelUsageService", () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe("computeCostMicroUsd", () => {
    it("prices a known model from the per-token micro-USD table", () => {
      // claude-sonnet-4-5: in 3, out 15, cacheRead 0.3, cacheWrite 3.75 (µ$/tok)
      const cost = computeCostMicroUsd(
        "claude-sonnet-4-5",
        usage({ inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheCreationTokens: 100 }),
      );
      // 1000*3 + 500*15 + 2000*0.3 + 100*3.75 = 3000 + 7500 + 600 + 375 = 11475
      expect(cost).toBe(11475);
    });

    it("returns null for an unknown/unpriced model (no throw)", () => {
      expect(computeCostMicroUsd("some-unreleased-model", usage({ inputTokens: 100 }))).toBeNull();
      expect(computeCostMicroUsd(null, usage({ inputTokens: 100 }))).toBeNull();
    });

    it("rounds to an integer micro-USD value", () => {
      const cost = computeCostMicroUsd("claude-sonnet-4-5", usage({ cacheReadTokens: 1 }));
      // 1 * 0.3 = 0.3 → rounds to 0
      expect(Number.isInteger(cost)).toBe(true);
    });
  });

  describe("recordUsage + usageByScope", () => {
    it("persists an event with computed cost and aggregates by session", async () => {
      await recordUsage(principal, "anthropic", usage({ inputTokens: 1000, outputTokens: 500 }));
      await recordUsage(principal, "anthropic", usage({ inputTokens: 200, outputTokens: 100 }));

      const agg = await usageByScope("session", "session-1");
      expect(agg.inputTokens).toBe(1200);
      expect(agg.outputTokens).toBe(600);
      // cost: (1000*3+500*15) + (200*3+100*15) = 10500 + 2100 = 12600
      expect(agg.costMicroUsd).toBe(12600);
      expect(agg.events).toBe(2);
    });

    it("aggregates by user and by instance", async () => {
      await recordUsage(principal, "anthropic", usage({ inputTokens: 10 }));
      await recordUsage(
        { ...principal, sessionId: "session-2" },
        "anthropic",
        usage({ inputTokens: 5 }),
      );
      const byUser = await usageByScope("user", "user-1");
      expect(byUser.inputTokens).toBe(15);
      expect(byUser.events).toBe(2);

      const byInstance = await usageByScope("instance", "alpha");
      expect(byInstance.inputTokens).toBe(15);
    });

    it("records token counts even when the model is unpriced (cost null)", async () => {
      await recordUsage(principal, "anthropic", usage({ model: "mystery-model", inputTokens: 42 }));
      const row = await testDb.query.modelUsageEvents.findFirst({
        where: (t, { eq }) => eq(t.userId, "user-1"),
      });
      expect(row?.inputTokens).toBe(42);
      expect(row?.costMicroUsd).toBeNull();
    });

    it("never throws when recording (a metering failure must not break the proxy)", async () => {
      await expect(
        recordUsage(principal, "anthropic", usage({ inputTokens: 1 })),
      ).resolves.toBeUndefined();
    });
  });
});
